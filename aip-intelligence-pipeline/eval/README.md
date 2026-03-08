# Golden Question Eval (Phase 6.1+)

This directory stores thesis evaluation artifacts for Objective 2a (acceptance rate).

## Evaluation Scope (Phase 6.2)

- City scope: `City of Cabuyao` (FY 2022 only).
- Barangay scope: `Mamatid` and `Pulo` only (FY 2025/2026).
- `San Isidro` and `Banay-Banay` are excluded from evaluation because published AIPs were unavailable at evaluation time.
- Active prompt version: `prompts/golden-questions-v2.txt`.
- Recommended dataset target: `questions/v2/questions.jsonl`.

## Contents

- `prompts/golden-questions-v1.txt`
  - Historical prompt for original 4-barangay scope.
- `prompts/golden-questions-v2.txt`
  - Current prompt for reduced evaluation scope.
- `questions/v1/`
  - Historical v1 artifacts (retained for traceability).
- `questions/v2/questions.jsonl`
  - Main dataset path for reduced scope (must eventually contain exactly 200 JSONL lines).
- `questions/v2/questions.sample.jsonl`
  - Small schema-valid sample set for quick checks.
- `schema/golden-question.schema.json`
  - JSON Schema for one JSONL object.
- `validate_questions.py`
  - Strict validator for schema + count/distribution constraints.

## Generation workflow

1. Open `eval/prompts/golden-questions-v2.txt`.
2. Paste the prompt into your LLM tool.
3. Save LLM output as JSONL to:
   - `eval/questions/v2/questions.jsonl`
4. Ensure no blank lines and exactly one JSON object per line.

## Validation commands

From `aip-intelligence-pipeline`:

```powershell
python eval/validate_questions.py --path eval/questions/v2/questions.jsonl
```

Schema-only validation (JSON + schema, without global 200/count constraints):

```powershell
python eval/validate_questions.py --schema-only --path eval/questions/v2/questions.sample.jsonl
```

## Strategy Regression (Phase 4)

Run strategy behavior regression (route/rewrite/planner/gate/verifier telemetry comparisons):

```powershell
python -m eval.run_strategy_regression --input eval/questions/strategy/v1/cases.jsonl --stateful
```

Compare two strategy runs:

```powershell
python -m eval.compare_strategy_runs --base eval/results/<base>/summary.json --candidate eval/results/<candidate>/summary.json
```

## Notes

- The provided v2 `questions.jsonl` is an initial placeholder and is expected to fail full validation until replaced by the true 200-question output.
- Phase 6.2 will add runner execution and metrics computation.
