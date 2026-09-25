use std::collections::HashMap;
use std::time::Duration;
use reqwest::Client;
use tracing::{info, warn};
use crate::models::{MonosansProxy, Proxy};

pub async fn fetch_all_proxies(client: &Client) -> Vec<Proxy> {
    info!("[Fetcher] Starting proxy list aggregation...");
    let mut proxy_map: HashMap<(String, u16), Proxy> = HashMap::new();

    // Helper closure to insert or merge
    let mut add_proxy = |host: String, port: u16, protocol: String, country: String, country_name: String, city: String, org: String, latency: Option<u32>, alive: Option<bool>, source: String| {
        let clean_host = host.trim().to_string();
        if clean_host.is_empty() || port == 0 {
            return;
        }

        let key = (clean_host.clone(), port);
        let proto_clean = protocol.to_lowercase();

        if let Some(existing) = proxy_map.get_mut(&key) {
            if !existing.protocols.contains(&proto_clean) {
                existing.protocols.push(proto_clean);
            }
            if existing.country == "UN" && country != "UN" {
                existing.country = country;
                if !country_name.is_empty() {
                    existing.country_name = country_name;
                }
            }
            if existing.org.is_empty() && !org.is_empty() {
                existing.org = org;
            }
            if !existing.sources.contains(&source) {
                existing.sources.push(source);
            }
        } else {
            let id = format!("{}:{}", clean_host, port);
            proxy_map.insert(key, Proxy {
                id,
                host: clean_host,
                port,
                protocols: vec![proto_clean],
                country,
                country_name,
                city,
                org,
                latency,
                alive,
                last_checked: None,
                sources: vec![source],
            });
        }
    };

    // 1. Fetch monosans structured JSON
    let monosans_url = "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json";
    match client.get(monosans_url).timeout(Duration::from_secs(15)).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(items) = resp.json::<Vec<MonosansProxy>>().await {
                    let count = items.len();
                    for item in items {
                        let country = item.geolocation.as_ref()
                            .and_then(|g| g.country.as_ref())
                            .and_then(|c| c.iso_code.clone())
                            .unwrap_or_else(|| "UN".to_string())
                            .to_uppercase();

                        let country_name = item.geolocation.as_ref()
                            .and_then(|g| g.country.as_ref())
                            .and_then(|c| c.names.as_ref())
                            .and_then(|n| n.get("en").cloned())
                            .unwrap_or_else(|| "Unknown".to_string());

                        let city = item.geolocation.as_ref()
                            .and_then(|g| g.city.as_ref())
                            .and_then(|c| c.names.as_ref())
                            .and_then(|n| n.get("en").cloned())
                            .unwrap_or_default();

                        let org = item.asn.as_ref()
                            .and_then(|a| a.autonomous_system_organization.clone())
                            .unwrap_or_default();

                        let latency = item.timeout.map(|t| (t * 1000.0).round() as u32);

                        add_proxy(
                            item.host,
                            item.port,
                            item.protocol,
                            country,
                            country_name,
                            city,
                            org,
                            latency,
                            Some(true),
                            "monosans".to_string(),
                        );
                    }
                    info!("[Fetcher] monosans parsed: {} proxies", count);
                }
            }
        }
        Err(e) => warn!("[Fetcher] monosans fetch error: {}", e),
    }

    // 2. TheSpeedX lists (HTTP, SOCKS4, SOCKS5)
    let speedx_tasks = vec![
        ("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", "http"),
        ("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", "socks4"),
        ("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", "socks5"),
    ];

    for (url, proto) in speedx_tasks {
        match client.get(url).timeout(Duration::from_secs(12)).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    if let Ok(text) = resp.text().await {
                        let mut count = 0;
                        for line in text.lines() {
                            let trimmed = line.trim();
                            if trimmed.is_empty() || trimmed.starts_with('#') {
                                continue;
                            }
                            if let Some((h, p)) = trimmed.split_once(':') {
                                if let Ok(port) = p.parse::<u16>() {
                                    add_proxy(
                                        h.to_string(),
                                        port,
                                        proto.to_string(),
                                        "UN".to_string(),
                                        "Unknown".to_string(),
                                        String::new(),
                                        String::new(),
                                        None,
                                        None,
                                        "thespeedx".to_string(),
                                    );
                                    count += 1;
                                }
                            }
                        }
                        info!("[Fetcher] TheSpeedX {} parsed: {} proxies", proto, count);
                    }
                }
            }
            Err(e) => warn!("[Fetcher] TheSpeedX {} error: {}", proto, e),
        }
    }

    // 3. hookzof SOCKS5 list
    let hookzof_url = "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt";
    match client.get(hookzof_url).timeout(Duration::from_secs(12)).send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                if let Ok(text) = resp.text().await {
                    let mut count = 0;
                    for line in text.lines() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() || trimmed.starts_with('#') {
                            continue;
                        }
                        if let Some((h, p)) = trimmed.split_once(':') {
                            if let Ok(port) = p.parse::<u16>() {
                                add_proxy(
                                    h.to_string(),
                                    port,
                                    "socks5".to_string(),
                                    "UN".to_string(),
                                    "Unknown".to_string(),
                                    String::new(),
                                    String::new(),
                                    None,
                                    None,
                                    "hookzof".to_string(),
                                );
                                count += 1;
                            }
                        }
                    }
                    info!("[Fetcher] hookzof SOCKS5 parsed: {} proxies", count);
                }
            }
        }
        Err(e) => warn!("[Fetcher] hookzof error: {}", e),
    }

    let results: Vec<Proxy> = proxy_map.into_values().collect();
    info!("[Fetcher] Completed aggregation. Total unique proxies: {}", results.len());
    results
}
