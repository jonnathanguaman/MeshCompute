param(
  [Parameter(Mandatory = $true)]
  [string]$MarketplaceApiUrl,

  [string]$ProviderName = "GTX1070-Provider",
  [string]$ProviderWallet = "0x0000000000000000000000000000000000000001",
  [string]$ProviderHardware = "NVIDIA-GTX-1070",
  [string]$ProviderModelKey = "demo-llm",
  [string]$ProviderModelLabel = "Llama-3.2-1B-Instruct-Q4_0",
  [string]$ProviderPriceAtomic = "2000"
)

if ($MarketplaceApiUrl -match "localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.") {
  Write-Error "MarketplaceApiUrl must be the other PC's reachable URL, preferably its Tailscale URL like http://100.x.x.x:4000."
  exit 1
}

$env:MARKETPLACE_API_URL = $MarketplaceApiUrl.TrimEnd("/")
$env:MARKETPLACE_DISABLED = "false"
$env:PROVIDER_NAME = $ProviderName
$env:PROVIDER_WALLET = $ProviderWallet
$env:PROVIDER_HARDWARE = $ProviderHardware
$env:PROVIDER_MODEL_KEY = $ProviderModelKey
$env:PROVIDER_MODEL_LABEL = $ProviderModelLabel
$env:PROVIDER_PRICE_ATOMIC = $ProviderPriceAtomic
$env:PROVIDER_WARMUP_MODEL = "true"
$env:QVAC_FIREWALL_ALLOWED_KEYS = ""

pnpm.cmd provider:start
