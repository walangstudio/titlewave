#!/usr/bin/env bash
set -euo pipefail
npm run build
npm test
npm run test:integration
python3 test/terminals.py
TITLEWAVE_TEST_RESUME=1 python3 test/terminals.py
node test/packages.mjs
claude plugin validate .
