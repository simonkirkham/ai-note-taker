// EvalRunnerTests toggles the process-wide RUN_BEDROCK_EVAL flag to prove the
// IsEnabled gate. Disabling parallelization stops that global mutation from
// racing the RUN_BEDROCK_EVAL-gated live tests in other classes.
[assembly: Xunit.CollectionBehavior(DisableTestParallelization = true)]
