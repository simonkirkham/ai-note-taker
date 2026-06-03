# Convenience targets. The full build/test commands live in CLAUDE.md / README.

.PHONY: eval eval-offline

# Run the analysis eval harness against all accessible Nova models and print the
# report. Needs AWS credentials (e.g. AWS_PROFILE=prod). See scripts/run-eval.sh.
eval:
	bash scripts/run-eval.sh

# Run only the offline harness tests (scorers, loader, corpus guards) — no Bedrock.
eval-offline:
	dotnet test tests/Analysis.Eval/Analysis.Eval.csproj
