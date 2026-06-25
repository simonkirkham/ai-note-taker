using Xunit;

// CDK App construction extracts JSII asset bundles (e.g. aws-cdk-asset-awscli-v1-*.tgz) into a
// shared temp directory. When two test classes each build a Template from a static initializer,
// xUnit runs them in parallel (each class is its own collection by default) and the concurrent
// extractions race on the same file — throwing
//   IOException: The process cannot access the file '...aws-cdk-asset-awscli-v1-*.tgz' because
//   it is being used by another process.
// Serialize this assembly's collections so the synth-in-static-ctor classes never overlap.
// (Added with Phase 32-A, which introduced the second infra test class.)
[assembly: CollectionBehavior(DisableTestParallelization = true)]
