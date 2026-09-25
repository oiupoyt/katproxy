mod models;
mod fetcher;
mod checker;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use axum::Router;
use reqwest::Client;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::models::{
    CountryCount, ProtocolStats, ProxiesQuery, ProxiesResponse, Proxy, RawQuery, StatsResponse,
};

const REFRESH_INTERVAL_SECS: u64 = 15 * 60; // 15 mins

#[derive(Clone)]
pub struct AppState {
    pub proxies: Arc<RwLock<Vec<Proxy>>>,
    pub last_updated: Arc<AtomicU64>,
    pub next_refresh_time: Arc<AtomicU64>,
    pub is_refreshing: Arc<AtomicBool>,
    pub is_checking: Arc<AtomicBool>,
    pub start_time: Instant,
    pub http_client: Client,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer().compact())
        .init();

    let client = Client::builder()
        .user_agent("katproxy-rs/1.0")
        .timeout(Duration::from_secs(15))
        .build()
        .expect("Failed to build HTTP client");

    let state = AppState {
        proxies: Arc::new(RwLock::new(Vec::new())),
        last_updated: Arc::new(AtomicU64::new(0)),
        next_refresh_time: Arc::new(AtomicU64::new(0)),
        is_refreshing: Arc::new(AtomicBool::new(false)),
        is_checking: Arc::new(AtomicBool::new(false)),
        start_time: Instant::now(),
        http_client: client,
    };

    // Spawn background refresh worker
    let worker_state = state.clone();
    tokio::spawn(async move {
        // Initial fetch immediately
        run_refresh_cycle(&worker_state).await;

        let mut interval = tokio::time::interval(Duration::from_secs(REFRESH_INTERVAL_SECS));
        // First tick completes immediately, skip it
        interval.tick().await;

        loop {
            interval.tick().await;
            run_refresh_cycle(&worker_state).await;
        }
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Serve public directory if exists
    let public_dir = std::path::Path::new("public");
    let fallback_public_dir = std::path::Path::new("../public");
    let static_service = if public_dir.exists() {
        ServeDir::new(public_dir)
    } else {
        ServeDir::new(fallback_public_dir)
    };

    let app = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/stats", get(stats_handler))
        .route("/api/proxies", get(proxies_handler))
        .route("/api/raw", get(raw_handler))
        .route("/api/refresh", post(refresh_handler))
        .fallback_service(static_service)
        .layer(cors)
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5050);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[Server] katproxy-backend (Rust) listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    axum::serve(listener, app)
        .await
        .expect("Server failed during execution");
}

/// Run full refresh cycle: fetch upstreams, deduplicate, probe top batch
async fn run_refresh_cycle(state: &AppState) {
    if state.is_refreshing.swap(true, Ordering::SeqCst) {
        return;
    }

    info!("[Server] Running background proxy refresh cycle...");
    let fetched = fetcher::fetch_all_proxies(&state.http_client).await;

    if !fetched.is_empty() {
        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let next_refresh = now_ts + (REFRESH_INTERVAL_SECS * 1000);

        {
            let mut lock = state.proxies.write().await;
            *lock = fetched;
        }

        state.last_updated.store(now_ts, Ordering::SeqCst);
        state.next_refresh_time.store(next_refresh, Ordering::SeqCst);

        // Run background TCP latency probe on top 350 proxies
        if !state.is_checking.swap(true, Ordering::SeqCst) {
            let probe_state = state.clone();
            tokio::spawn(async move {
                info!("[Server] Starting background TCP latency verification...");
                let mut proxies_clone = {
                    let lock = probe_state.proxies.read().await;
                    lock.clone()
                };

                let target_len = proxies_clone.len().min(350);
                if target_len > 0 {
                    checker::probe_proxies_batch(
                        &mut proxies_clone[..target_len],
                        40,
                        Duration::from_millis(2000),
                    )
                    .await;

                    // Update store with probed results
                    let mut lock = probe_state.proxies.write().await;
                    for (i, p) in proxies_clone.into_iter().take(target_len).enumerate() {
                        if i < lock.len() {
                            lock[i].alive = p.alive;
                            lock[i].latency = p.latency;
                            lock[i].last_checked = p.last_checked;
                        }
                    }
                }
                probe_state.is_checking.store(false, Ordering::SeqCst);
                info!("[Checker] Latency probing completed.");
            });
        }
    }

    state.is_refreshing.store(false, Ordering::SeqCst);
}

// Handlers

async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    let now = chrono::Utc::now().to_rfc3339();
    Json(serde_json::json!({
        "status": "ok",
        "service": "katproxy-backend-rs",
        "uptime": state.start_time.elapsed().as_secs(),
        "timestamp": now
    }))
}

async fn stats_handler(State(state): State<AppState>) -> impl IntoResponse {
    let proxies = state.proxies.read().await;
    let total = proxies.len();

    let mut alive_count = 0;
    let mut http_count = 0;
    let mut socks4_count = 0;
    let mut socks5_count = 0;
    let mut latencies = Vec::new();
    let mut country_map: HashMap<String, usize> = HashMap::new();

    for p in proxies.iter() {
        if p.alive == Some(true) {
            alive_count += 1;
            if let Some(lat) = p.latency {
                latencies.push(lat);
            }
        }

        for proto in &p.protocols {
            match proto.as_str() {
                "http" => http_count += 1,
                "socks4" => socks4_count += 1,
                "socks5" => socks5_count += 1,
                _ => {}
            }
        }

        let c = if p.country.is_empty() { "UN" } else { &p.country };
        *country_map.entry(c.to_string()).or_insert(0) += 1;
    }

    let mut top_countries: Vec<CountryCount> = country_map
        .into_iter()
        .map(|(country, count)| CountryCount { country, count })
        .collect();
    top_countries.sort_by(|a, b| b.count.cmp(&a.count));
    top_countries.truncate(10);

    let avg_latency = if !latencies.is_empty() {
        (latencies.iter().map(|&v| v as u64).sum::<u64>() / latencies.len() as u64) as u32
    } else {
        0
    };

    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let next_refresh = state.next_refresh_time.load(Ordering::SeqCst);
    let remaining_seconds = if next_refresh > now_ts {
        (next_refresh - now_ts) / 1000
    } else {
        0
    };

    let last_updated = state.last_updated.load(Ordering::SeqCst);

    Json(StatsResponse {
        total,
        alive_count,
        protocols: ProtocolStats {
            http: http_count,
            socks4: socks4_count,
            socks5: socks5_count,
        },
        top_countries,
        avg_latency,
        last_updated: if last_updated > 0 { Some(last_updated) } else { None },
        next_refresh_time: if next_refresh > 0 { Some(next_refresh) } else { None },
        remaining_seconds,
        is_refreshing: state.is_refreshing.load(Ordering::SeqCst),
        is_checking: state.is_checking.load(Ordering::SeqCst),
    })
}

async fn proxies_handler(
    State(state): State<AppState>,
    Query(query): Query<ProxiesQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(60).clamp(1, 1000);
    let page = query.page.unwrap_or(1).max(1);

    let proxies = state.proxies.read().await;

    // Filter
    let mut filtered: Vec<Proxy> = proxies
        .iter()
        .filter(|p| {
            // Protocol filter
            if let Some(ref proto) = query.protocol {
                if proto != "all" && !p.protocols.contains(&proto.to_lowercase()) {
                    return false;
                }
            }
            // Country filter
            if let Some(ref c) = query.country {
                if c != "all" && p.country != c.to_uppercase() {
                    return false;
                }
            }
            // Alive filter
            if let Some(ref alv) = query.alive {
                if alv == "true" && p.alive != Some(true) {
                    return false;
                } else if alv == "false" && p.alive != Some(false) {
                    return false;
                }
            }
            // Max latency
            if let Some(max_lat) = query.max_latency {
                if let Some(lat) = p.latency {
                    if lat > max_lat {
                        return false;
                    }
                } else {
                    return false;
                }
            }
            // Search text
            if let Some(ref search) = query.search {
                let q = search.trim().to_lowercase();
                if !q.is_empty() {
                    let port_str = p.port.to_string();
                    let match_host = p.host.contains(&q);
                    let match_port = port_str.contains(&q);
                    let match_country = p.country.to_lowercase().contains(&q) || p.country_name.to_lowercase().contains(&q);
                    let match_org = p.org.to_lowercase().contains(&q);
                    let match_city = p.city.to_lowercase().contains(&q);

                    if !(match_host || match_port || match_country || match_org || match_city) {
                        return false;
                    }
                }
            }
            true
        })
        .cloned()
        .collect();

    // Sort
    let sort = query.sort.as_deref().unwrap_or("latency_asc");
    match sort {
        "latency_asc" => {
            filtered.sort_by_key(|p| p.latency.unwrap_or(u32::MAX));
        }
        "latency_desc" => {
            filtered.sort_by(|a, b| {
                let lat_a = a.latency.unwrap_or(0);
                let lat_b = b.latency.unwrap_or(0);
                lat_b.cmp(&lat_a)
            });
        }
        "country" => {
            filtered.sort_by(|a, b| a.country.cmp(&b.country));
        }
        "port" => {
            filtered.sort_by_key(|p| p.port);
        }
        _ => {}
    }

    let total = filtered.len();
    let total_pages = if total == 0 { 1 } else { (total + limit - 1) / limit };
    let start_idx = (page - 1) * limit;

    let paginated = if start_idx >= total {
        Vec::new()
    } else {
        filtered
            .into_iter()
            .skip(start_idx)
            .take(limit)
            .collect()
    };

    Json(ProxiesResponse {
        total,
        page,
        limit,
        total_pages,
        proxies: paginated,
    })
}

async fn raw_handler(
    State(state): State<AppState>,
    Query(query): Query<RawQuery>,
) -> impl IntoResponse {
    let proxies = state.proxies.read().await;

    let lines: Vec<String> = proxies
        .iter()
        .filter(|p| {
            if let Some(ref proto) = query.protocol {
                if proto != "all" && !p.protocols.contains(&proto.to_lowercase()) {
                    return false;
                }
            }
            if let Some(ref alv) = query.alive {
                if alv == "true" && p.alive != Some(true) {
                    return false;
                }
            }
            true
        })
        .map(|p| {
            if query.format.as_deref() == Some("url") {
                let proto = p.protocols.first().map(|s| s.as_str()).unwrap_or("http");
                format!("{}://{}:{}", proto, p.host, p.port)
            } else {
                format!("{}:{}", p.host, p.port)
            }
        })
        .collect();

    let output = lines.join("\n");
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "text/plain; charset=utf-8".parse().unwrap());

    (headers, output)
}

async fn refresh_handler(State(state): State<AppState>) -> Response {
    if state.is_refreshing.load(Ordering::SeqCst) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Refresh already in progress" })),
        )
            .into_response();
    }

    let worker_state = state.clone();
    tokio::spawn(async move {
        run_refresh_cycle(&worker_state).await;
    });

    Json(serde_json::json!({
        "success": true,
        "message": "Proxy aggregation started in background"
    }))
    .into_response()
}
