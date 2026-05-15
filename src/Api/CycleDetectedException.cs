namespace Api;

public sealed class CycleDetectedException(string message) : InvalidOperationException(message);
