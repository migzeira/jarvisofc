#!/bin/bash
# Run Minha Maya unit tests
# Usage: bash supabase/functions/tests/run_tests.sh

cd "$(dirname "$0")/../../../"
deno test --allow-env supabase/functions/tests/ --no-check
