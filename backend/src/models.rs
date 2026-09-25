use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Proxy {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub protocols: Vec<String>,
    pub country: String,
    #[serde(rename = "countryName")]
    pub country_name: String,
    pub city: String,
    pub org: String,
    pub latency: Option<u32>,
    pub alive: Option<bool>,
    #[serde(rename = "lastChecked")]
    pub last_checked: Option<u64>,
    pub sources: Vec<String>,
}

#[derive(Serialize)]
pub struct StatsResponse {
    pub total: usize,
    #[serde(rename = "aliveCount")]
    pub alive_count: usize,
    pub protocols: ProtocolStats,
    #[serde(rename = "topCountries")]
    pub top_countries: Vec<CountryCount>,
    #[serde(rename = "avgLatency")]
    pub avg_latency: u32,
    #[serde(rename = "lastUpdated")]
    pub last_updated: Option<u64>,
    #[serde(rename = "nextRefreshTime")]
    pub next_refresh_time: Option<u64>,
    #[serde(rename = "remainingSeconds")]
    pub remaining_seconds: u64,
    #[serde(rename = "isRefreshing")]
    pub is_refreshing: bool,
    #[serde(rename = "isChecking")]
    pub is_checking: bool,
}

#[derive(Serialize)]
pub struct ProtocolStats {
    pub http: usize,
    pub socks4: usize,
    pub socks5: usize,
}

#[derive(Serialize)]
pub struct CountryCount {
    pub country: String,
    pub count: usize,
}

#[derive(Serialize)]
pub struct ProxiesResponse {
    pub total: usize,
    pub page: usize,
    pub limit: usize,
    #[serde(rename = "totalPages")]
    pub total_pages: usize,
    pub proxies: Vec<Proxy>,
}

#[derive(Deserialize, Default)]
pub struct ProxiesQuery {
    pub protocol: Option<String>,
    pub country: Option<String>,
    pub alive: Option<String>,
    #[serde(rename = "maxLatency")]
    pub max_latency: Option<u32>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<usize>,
    pub page: Option<usize>,
}

#[derive(Deserialize, Default)]
pub struct RawQuery {
    pub protocol: Option<String>,
    pub alive: Option<String>,
    pub format: Option<String>,
}

// Struct for parsing monosans proxies.json
#[derive(Deserialize, Debug)]
pub struct MonosansProxy {
    pub host: String,
    pub port: u16,
    pub protocol: String,
    pub timeout: Option<f64>,
    pub asn: Option<MonosansAsn>,
    pub geolocation: Option<MonosansGeo>,
}

#[derive(Deserialize, Debug)]
pub struct MonosansAsn {
    pub autonomous_system_organization: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct MonosansGeo {
    pub country: Option<MonosansCountry>,
    pub city: Option<MonosansCity>,
}

#[derive(Deserialize, Debug)]
pub struct MonosansCountry {
    pub iso_code: Option<String>,
    pub names: Option<std::collections::HashMap<String, String>>,
}

#[derive(Deserialize, Debug)]
pub struct MonosansCity {
    pub names: Option<std::collections::HashMap<String, String>>,
}
