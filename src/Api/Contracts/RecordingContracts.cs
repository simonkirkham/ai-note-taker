namespace Api.Contracts;

public record RecordingPresignUploadResponse(string Key, string UploadUrl, string ContentType);

public record SaveRecordingRequest(string Key);

public record RecordingPresignDownloadResponse(string DownloadUrl);

// AnalyseOnCompletion (33-B2): the frontend's auto-analyse toggle at record time. When true the
// completion Lambda re-analyses the note on the diarized (or, on job failure, streamed) transcript;
// when false it diarizes only. Defaults false so an old client that omits it never triggers a
// surprise analysis.
public record DiarizeRequest(string Key, bool AnalyseOnCompletion = false);
