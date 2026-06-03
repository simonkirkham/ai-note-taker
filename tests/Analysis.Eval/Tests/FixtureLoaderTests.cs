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
        Assert.Contains("standup", standup.Expected.Tags);
    }
}
