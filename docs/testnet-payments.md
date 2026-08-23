# WDK testnet payments (Persona 2B)

## What this adds

MeshCompute can now pay the selected provider wallet through the backend after a
job reaches `VERIFIED`. The implementation uses Tether WDK's EVM wallet module
for ERC-20 transfers and keeps `SIMULATED` mode as the default.

This is a real blockchain integration on a test network, not a mainnet payment.
The receiver can be a normal external EVM wallet configured for the same testnet.
That gives the demo an explorer-verifiable transaction without risking real USDT
or production funds.

Official references:

- WDK EVM wallet module: https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm
- ERC-20 transfer flow: https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm/guides/transfer-tokens/
- WDK transaction lifecycle: https://docs.wdk.tether.io/sdk/core-module/guides/transactions/
- WDK source and beta notice: https://github.com/tetherto/wdk

## Safety boundaries

- `PAYMENT_MODE=SIMULATED` is the default and never touches a blockchain.
- `WDK_TESTNET` accepts only explicitly allowlisted EVM testnet chain IDs.
- Ethereum mainnet (`1`) and all other non-allowlisted networks are rejected at startup.
- The RPC-reported chain ID must exactly match `WDK_TESTNET_CHAIN_ID` before WDK is initialized.
- A WDK default-deny policy permits only the configured token, a valid EVM recipient and an amount below the cap.
- Token balance, native gas balance and the quoted fee are checked before broadcast.
- `WDK_MAX_TRANSFER_ATOMIC` and `WDK_MAX_FEE_WEI` provide hard caps.
- One job can create only one payment attempt. Repeating `settle` after success returns the recorded result without broadcasting again.
- Only normalized error codes reach the API or database; provider error details are not returned.
- `TREASURY_SEED_PHRASE` stays in backend environment configuration. It must never be placed in Git, SQLite, browser code, screenshots or logs.

Use a fresh disposable testnet-only mnemonic. Never reuse a wallet that has held
mainnet assets. Treat faucet funds and demo tokens as disposable.

## Testnet setup

The default configuration uses Ethereum Sepolia (`11155111`). Other networks are
possible only if their chain ID is already allowlisted in the payment adapter.

1. Create a fresh testnet-only treasury mnemonic and select account index `0`.
2. Use or deploy a demo ERC-20 token with six decimals on Sepolia. Do not present
   it as real USDT; `mUSDT` in MeshCompute is a demonstration token.
3. Fund the treasury account with a small amount of that demo token and Sepolia
   faucet ETH for gas.
4. Set the provider's `walletAddress` to the external recipient wallet on Sepolia.
5. Copy `.env.example` to `.env` and configure the backend values below.

```dotenv
PAYMENT_MODE=WDK_TESTNET
EVM_RPC_URL=https://your-sepolia-rpc.example
TESTNET_TOKEN_ADDRESS=0xYourSixDecimalDemoToken
TREASURY_SEED_PHRASE=your fresh disposable testnet mnemonic
TOKEN_DECIMALS=6
WDK_TESTNET_CHAIN_ID=11155111
WDK_ACCOUNT_INDEX=0
WDK_MAX_TRANSFER_ATOMIC=1000000
WDK_MAX_FEE_WEI=10000000000000000
WDK_RPC_TIMEOUT_MS=10000
```

The example caps one transfer at `1.000000` demo token and the quoted network fee
at `0.01` test ETH. Lower either cap for the final demo if practical.

## Verify without spending anything

The normal automated suite uses injected wallet doubles and never accesses an RPC
or broadcasts a transaction:

```powershell
pnpm typecheck
pnpm test
```

It covers chain mismatch, mainnet rejection, amount and fee caps, insufficient
token/gas balances, idempotency, concurrent settlement and safe failure handling.

## Run one explicit end-to-end demo transfer

Start the API with the WDK testnet environment configured. In another PowerShell
session, point the smoke flow at a disposable external testnet wallet:

```powershell
$env:PAYMENT_TEST_RECIPIENT='0xRecipientTestnetWallet'
$env:CONFIRM_TESTNET_TRANSFER='YES'
pnpm api:payment-smoke
```

The confirmation variable prevents accidental execution. The script creates and
verifies one low-value job, calls `POST /v1/jobs/{id}/settle`, and prints the
transaction hash. WDK returns that hash after broadcast; verify its inclusion and
status in the Sepolia explorer before presenting the payment as confirmed.

To immediately return to the no-chain mode, stop the API, set
`PAYMENT_MODE=SIMULATED`, and restart it.

## Integration contract for Personas A and C

- Persona A only needs to move the job to `VERIFIED`; it never receives the seed.
- Persona C calls `POST /v1/jobs/{id}/settle`, polls `GET /v1/jobs/{id}`, and may
  display `paymentMode`, `paymentStatus` and `paymentTxHash`.
- Persona C may link a testnet transaction hash to a block explorer, but no private
  wallet material or signing code belongs in the frontend.
- `GET /v1/stats` exposes public counters and `totalPaidAtomic` for the dashboard.

The exact schemas are in `docs/openapi.yaml`.
