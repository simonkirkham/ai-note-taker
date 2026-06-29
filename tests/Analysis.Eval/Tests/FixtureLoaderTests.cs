namespace Analysis.Eval.Tests;

public class FixtureLoaderTests
{
    [Fact]
    public void Loads_the_seed_fixture_from_disk()
    {
        var fixtures = FixtureLoader.LoadAll(
            Path.Combine(AppContext.BaseDirectory, "Fixtures"));

        var standup = Assert.Single(fixtures, f => f.Id == "01-standup-clear-owners");
        Assert.Equal("Alice", standup.CurrentUserName);
        // MPI-8: the standup names no proper noun, so its gold tag set is intentionally empty.
        Assert.Empty(standup.Expected.Tags);

        // A fixture that names organisations loads its proper-noun gold tags.
        var pipeline = Assert.Single(fixtures, f => f.Id == "05-sales-pipeline-review");
        Assert.Contains("acme", pipeline.Expected.Tags);
        Assert.Contains("globex", pipeline.Expected.Tags);
    }
}
