using Domain.Notes;

namespace Domain.Specs.Notes;

// BUG-47: the content hash is a cross-language contract — the .NET server and the web client (Web
// Crypto) must produce the same value or every content save from the browser would 409. Pin it to
// the standard SHA-256 test vectors (lower-hex over UTF-8); the web client pins the same vectors in
// its own test, so both sides target a fixed, known-correct value and can never silently drift apart.
public sealed class NoteContentHashSpec
{
    [Fact]
    public void EmptyContentHashesToTheKnownSha256OfEmpty() =>
        Assert.Equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            NoteContentHash.Compute(""));

    [Fact]
    public void NullContentIsTreatedAsEmpty() =>
        Assert.Equal(NoteContentHash.Compute(""), NoteContentHash.Compute(null));

    [Fact]
    public void AbcHashesToTheKnownSha256OfAbc() =>
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            NoteContentHash.Compute("abc"));
}
