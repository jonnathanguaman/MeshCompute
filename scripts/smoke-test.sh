#!/usr/bin/env bash
#
# Smoke test del Consumer Agent. Doc 00 §3.
#
# Arranca el agente con el adapter mock, ejercita /health y /v1/inference, y
# comprueba las garantias que no pueden romperse sin que la demo mienta:
#
#   - 5 inferencias consecutivas (DoD A, doc 01 §36);
#   - la cadena de 3 tools se ejecuta entera (T-11);
#   - el hash es SHA-256 de 64 hex y estable entre corridas;
#   - un payload con campos de mas se rechaza (privacidad, doc 00 §9).
#
# No sustituye a `pnpm test`: esto prueba el proceso real por HTTP.
#
#   ./scripts/smoke-test.sh

set -euo pipefail

PORT="${SMOKE_PORT:-5099}"
BASE="http://127.0.0.1:${PORT}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(mktemp)"
FAILURES=0

cleanup() {
  if [[ -n "${AGENT_PID:-}" ]]; then
    kill "${AGENT_PID}" 2>/dev/null || true
    wait "${AGENT_PID}" 2>/dev/null || true
  fi
  rm -f "${LOG}"
}
trap cleanup EXIT

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }

echo "starting consumer-agent on ${PORT} (mock adapter)..."
cd "${ROOT}"
QVAC_ADAPTER=mock \
MARKETPLACE_DISABLED=true \
CONSUMER_PORT="${PORT}" \
LOG_LEVEL=warn \
  pnpm tsx apps/consumer-agent/src/index.ts >"${LOG}" 2>&1 &
AGENT_PID=$!

# Esperar a que escuche, en vez de dormir a ciegas.
for _ in $(seq 1 60); do
  if curl -sf "${BASE}/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo
echo "=== health ==="
HEALTH="$(curl -sf "${BASE}/health" || echo '{}')"
if echo "${HEALTH}" | grep -q '"service":"consumer-agent"'; then
  pass "GET /health responde"
else
  fail "GET /health no respondio: ${HEALTH}"
  echo "--- agent log ---"; cat "${LOG}"; exit 1
fi

echo
echo "=== 5 inferencias consecutivas ==="
REQ="${ROOT}/docs/examples/inference-request.json"
FIRST_HASH=""

for i in 1 2 3 4 5; do
  RESP="$(curl -sf -X POST "${BASE}/v1/inference" \
    -H 'Content-Type: application/json' \
    -d @"${REQ}" || echo '{}')"

  STATUS="$(echo "${RESP}" | python -c 'import sys,json;print(json.load(sys.stdin).get("reliability",{}).get("status","?"))' 2>/dev/null || echo '?')"
  TOOLS="$(echo "${RESP}" | python -c 'import sys,json;print(json.load(sys.stdin).get("reliability",{}).get("successfulTools",-1))' 2>/dev/null || echo -1)"
  HASH="$(echo "${RESP}" | python -c 'import sys,json;print(json.load(sys.stdin).get("outputHash",""))' 2>/dev/null || echo '')"

  if [[ "${STATUS}" == "PASSED" && "${TOOLS}" == "3" ]]; then
    pass "run ${i}: reliability=PASSED, 3 tools"
  else
    fail "run ${i}: status=${STATUS} tools=${TOOLS}"
  fi

  if [[ ! "${HASH}" =~ ^[0-9a-f]{64}$ ]]; then
    fail "run ${i}: outputHash no es sha-256 hex de 64 (${HASH})"
  fi
  if [[ -z "${FIRST_HASH}" ]]; then
    FIRST_HASH="${HASH}"
  elif [[ "${HASH}" != "${FIRST_HASH}" ]]; then
    fail "run ${i}: el hash cambio entre corridas identicas"
  fi
done

echo
echo "=== privacidad: campos no declarados ==="
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/v1/inference" \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"job_123","executionToken":"t","provider":{"id":"p_001","qvacPublicKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","modelKey":"tooluse-llm"},"prompt":"x","verificationMode":"LOCAL_SCHEMA","exfiltrate":"http://evil.example"}')"
if [[ "${CODE}" == "400" ]]; then
  pass "un campo extra se rechaza con 400"
else
  fail "un campo extra devolvio ${CODE}, se esperaba 400"
fi

echo
echo "=== logs sin prompt ==="
if grep -qi "Analyze this MeshCompute job" "${LOG}"; then
  fail "el prompt aparecio en los logs del agente"
else
  pass "el prompt no aparece en los logs"
fi

echo
if [[ "${FAILURES}" -eq 0 ]]; then
  echo "smoke test OK"
  exit 0
fi
echo "smoke test: ${FAILURES} fallo(s)"
echo "--- agent log ---"
cat "${LOG}"
exit 1
