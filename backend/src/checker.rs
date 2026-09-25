use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;
use tokio::time::timeout;
use tracing::info;
use crate::models::Proxy;

/// Probe a single proxy's host:port over TCP
pub async fn probe_proxy(host: &str, port: u16, timeout_duration: Duration) -> (bool, Option<u32>) {
    let target = format!("{}:{}", host, port);
    let start = Instant::now();

    match timeout(timeout_duration, TcpStream::connect(&target)).await {
        Ok(Ok(_stream)) => {
            let elapsed = start.elapsed().as_millis() as u32;
            (true, Some(elapsed))
        }
        _ => (false, None),
    }
}

/// Concurrently probe a slice of proxies up to limit using a semaphore
pub async fn probe_proxies_batch(proxies: &mut [Proxy], concurrency: usize, timeout_duration: Duration) {
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let mut handles = Vec::new();

    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    for (idx, p) in proxies.iter().enumerate() {
        let sem = semaphore.clone();
        let host = p.host.clone();
        let port = p.port;

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let (alive, latency) = probe_proxy(&host, port, timeout_duration).await;
            (idx, alive, latency)
        }));
    }

    let mut completed = 0;
    let total = handles.len();

    for handle in handles {
        if let Ok((idx, alive, latency)) = handle.await {
            proxies[idx].alive = Some(alive);
            if alive {
                proxies[idx].latency = latency;
            }
            proxies[idx].last_checked = Some(now_ts);
            completed += 1;
            if completed % 100 == 0 || completed == total {
                info!("[Checker] Latency probe progress: {}/{}", completed, total);
            }
        }
    }
}
