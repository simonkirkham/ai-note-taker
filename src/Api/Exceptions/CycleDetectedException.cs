namespace Api.Exceptions;

public sealed class CycleDetectedException(string message) : InvalidOperationException(message);
