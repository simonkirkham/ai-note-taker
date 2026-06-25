using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.Cognito;
using Amazon.CDK.AWS.DynamoDB;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.Route53.Targets;
using Amazon.CDK.AWS.RUM;
using Amazon.CDK.AWS.S3;
using Amazon.CDK.AWS.SecretsManager;
using Constructs;

public sealed class NoteTakerStack : Stack
{
    public NoteTakerStack(Construct scope, string id, NoteTakerStackProps props) : base(scope, id, props)
    {
        // ── Event store ──────────────────────────────────────────────────
        var eventsTable = new Table(this, "EventsTable", new TableProps
        {
            TableName = "notetaker-events",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN,
            // 27-B: fan-out transport for the async Projector Lambda. NEW_IMAGE is enough
            // to re-fold a stream — the projector reads the stream id off the new image and
            // replays the event store, it does not need the OLD image. Enabling a stream is
            // a one-off stack-update cost, not a recurring per-deploy tax.
            Stream = StreamViewType.NEW_IMAGE
        });

        // ── Projection tables ────────────────────────────────────────────
        var projTable = new Table(this, "ProjNoteTitleListTable", new TableProps
        {
            TableName = "notetaker-proj-notetitlelist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var noteDetailTable = new Table(this, "ProjNoteDetailTable", new TableProps
        {
            TableName = "notetaker-proj-notedetail",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var noteActionsTable = new Table(this, "ProjNoteActionsTable", new TableProps
        {
            TableName = "notetaker-proj-noteactions",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var todoListTable = new Table(this, "ProjTodoListTable", new TableProps
        {
            TableName = "notetaker-proj-todolist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });
        todoListTable.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
        {
            IndexName = "NoteId-index",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "NoteId", Type = AttributeType.STRING },
            ProjectionType = ProjectionType.ALL
        });

        var noteCardListTable = new Table(this, "ProjNoteCardListTable", new TableProps
        {
            TableName = "notetaker-proj-notecardlist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var folderTreeTable = new Table(this, "ProjFolderTreeTable", new TableProps
        {
            TableName = "notetaker-proj-foldertree",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var tagIndexTable = new Table(this, "ProjTagIndexTable", new TableProps
        {
            TableName = "notetaker-proj-tagindex",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "Tag", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "NoteId", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var tagFeedbackTable = new Table(this, "ProjTagFeedbackTable", new TableProps
        {
            TableName = "notetaker-proj-tagfeedback",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var actionFeedbackTable = new Table(this, "ProjActionFeedbackTable", new TableProps
        {
            TableName = "notetaker-proj-actionfeedback",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var calendarLinkIndexTable = new Table(this, "ProjCalendarLinkIndexTable", new TableProps
        {
            TableName = "notetaker-proj-calendarlinkindex",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "CalendarEventId", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            PointInTimeRecoverySpecification = new PointInTimeRecoverySpecification { PointInTimeRecoveryEnabled = true },
            RemovalPolicy = RemovalPolicy.RETAIN
        });
        calendarLinkIndexTable.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
        {
            IndexName = "RecurringSeriesId-index",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "RecurringSeriesId", Type = AttributeType.STRING },
            ProjectionType = ProjectionType.ALL
        });

        var noteSearchViewTable = new Table(this, "ProjNoteSearchViewTable", new TableProps
        {
            TableName = "notetaker-proj-notesearchview",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });
        noteSearchViewTable.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
        {
            IndexName = "UserId-index",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "UserId", Type = AttributeType.STRING },
            ProjectionType = ProjectionType.ALL
        });

        var workspaceListTable = new Table(this, "ProjWorkspaceListTable", new TableProps
        {
            TableName = "notetaker-proj-workspacelist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // ── Projector processed-position guard (27-B) ────────────────────
        // Highest applied event sequence per stream, so a redelivered stream record
        // is skipped instead of re-applied — the redelivery-idempotency mechanism the
        // increment-based feedback counters need. Reconstructible by replay (the event
        // log is authoritative), so DESTROY: a teardown loses only the cursor, which a
        // re-drive from TRIM_HORIZON rebuilds. Created before the Projector Lambda so its
        // name rides the constructor Environment dict.
        var projPositionTable = new Table(this, "ProjPositionTable", new TableProps
        {
            TableName = "notetaker-proj-position",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        // ── Projector dead-letter queue (27-B) ───────────────────────────
        // On-failure destination for the DynamoDB event-source mapping: a record that
        // still throws after bisect + retry exhaustion lands here instead of vanishing
        // or wedging the shard. 14-day retention gives ample time to inspect/redrive.
        var projectorDlq = new Amazon.CDK.AWS.SQS.Queue(this, "ProjectorDlq", new Amazon.CDK.AWS.SQS.QueueProps
        {
            QueueName = "notetaker-projector-dlq",
            RetentionPeriod = Duration.Days(14)
        });

        // ── Working-state store (NOT a projection, NOT the event log) ─────
        // In-progress transcription drafts, overwritten in place and self-reaped
        // via TTL. Loss-tolerant recovery buffer (ADR 0011): DESTROY removal,
        // since nothing authoritative lives here.
        var draftTranscriptionTable = new Table(this, "DraftTranscriptionTable", new TableProps
        {
            TableName = "notetaker-draft-transcription",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            TimeToLiveAttribute = "TTL",
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        // ── Auth refresh-token store (30-A) ──────────────────────────────
        // Server-side copy of each user's Google refresh token, keyed by their Google `sub`.
        // A long-lived credential only Google can re-issue — RETAIN so a stack teardown never
        // forces every user to re-consent. SSE-KMS encrypted at rest (AWS_MANAGED key); the
        // token value is never returned to the browser and never logged. Only the Command
        // Lambda gets RW (read/write below) — least privilege.
        var authTokensTable = new Table(this, "AuthTokensTable", new TableProps
        {
            TableName = "notetaker-auth-tokens",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "sub", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            Encryption = TableEncryption.AWS_MANAGED,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // 34-A: per-user calendar refresh tokens from the in-app "Connect calendar" flow.
        // (sub, provider) key so one user can connect Google + Microsoft independently. A durable
        // credential, not a projection → RETAIN, encrypted, never auto-deleted.
        var calendarTokensTable = new Table(this, "CalendarTokensTable", new TableProps
        {
            TableName = "notetaker-calendar-tokens",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "sub", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "provider", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            Encryption = TableEncryption.AWS_MANAGED,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // 35-E: MCP OAuth broker state.
        // Auth-code table: the short-lived OAuth state (pending-Google record + our issued
        // authorization code), single-use and TTL-reaped. Working state, not durable user data →
        // DESTROY, with TTL on the "TTL" attribute so DynamoDB self-purges expired rows.
        var mcpAuthCodeTable = new Table(this, "McpAuthCodeTable", new TableProps
        {
            TableName = "notetaker-mcp-auth-code",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "id", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            Encryption = TableEncryption.AWS_MANAGED,
            TimeToLiveAttribute = "TTL",
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        // Refresh-token table: rotating MCP refresh tokens (a durable credential keyed by the opaque
        // token) → RETAIN, encrypted. Single-use rotation is enforced in code (read-and-delete); a
        // bounded absolute lifetime is enforced in code AND TTL-reaped on the "TTL" attribute, so a
        // leaked/abandoned token cannot live forever.
        var mcpRefreshTokenTable = new Table(this, "McpRefreshTokenTable", new TableProps
        {
            TableName = "notetaker-mcp-refresh-token",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "token", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            Encryption = TableEncryption.AWS_MANAGED,
            TimeToLiveAttribute = "TTL",
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // HMAC (HS256) signing key for the MCP access tokens. CDK generates a random secret value;
        // the Command Lambda signs with it and the Query Lambda validates with it (GrantRead to both).
        // RETAIN so a stack teardown never invalidates live connectors. The secret NAME (not value)
        // rides the constructor env dict; the function fetches the value from Secrets Manager at boot.
        var mcpJwtSecret = new Secret(this, "McpJwtSigningSecret", new SecretProps
        {
            SecretName = "notetaker-mcp-jwt-signing-key",
            Description = "HMAC HS256 key the MCP OAuth broker signs/validates access tokens with",
            GenerateSecretString = new SecretStringGenerator
            {
                PasswordLength = 64,
                ExcludePunctuation = true
            },
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // ── Note images (user-uploaded blobs) ────────────────────────────
        // Private bucket: the browser uploads/downloads directly via presigned URLs,
        // so CORS must allow PUT/GET. RETAIN — user data is never auto-deleted on a
        // stack teardown. Created before the Lambda so its name goes in the function's
        // constructor Environment dict (a token there is part of the hashed config,
        // exactly like the table names) rather than a post-construction AddEnvironment.
        var imagesBucket = new Bucket(this, "NoteImagesBucket", new BucketProps
        {
            RemovalPolicy = RemovalPolicy.RETAIN,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            AutoDeleteObjects = false,
            Encryption = BucketEncryption.S3_MANAGED,
            Cors = new[]
            {
                new CorsRule
                {
                    AllowedMethods = new[] { HttpMethods.PUT, HttpMethods.GET },
                    AllowedOrigins = new[] { "*" },
                    AllowedHeaders = new[] { "*" },
                    MaxAge = 3000
                }
            },
            LifecycleRules = new[]
            {
                new LifecycleRule { AbortIncompleteMultipartUploadAfter = Duration.Days(1) }
            }
        });

        // ── Call recordings (Phase 33-A) ─────────────────────────────────
        // Working artefact, NOT durable user data: the captured WAV is uploaded on Stop so a
        // later batch-diarization job (33-B) can run over it. DESTROY + AutoDeleteObjects so a
        // stack teardown takes the bucket with it, and a 7-day lifecycle expiry so recordings
        // self-purge (cost-bounded; the transcript is the durable record, not the audio). CORS
        // PUT/GET for the browser's presigned upload + download. Created before the Lambda so its
        // name rides the constructor Environment dict (part of the hashed config).
        var recordingsBucket = new Bucket(this, "NoteRecordingsBucket", new BucketProps
        {
            RemovalPolicy = RemovalPolicy.DESTROY,
            AutoDeleteObjects = true,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            Encryption = BucketEncryption.S3_MANAGED,
            Cors = new[]
            {
                new CorsRule
                {
                    AllowedMethods = new[] { HttpMethods.PUT, HttpMethods.GET },
                    AllowedOrigins = new[] { "*" },
                    AllowedHeaders = new[] { "*" },
                    MaxAge = 3000
                }
            },
            LifecycleRules = new[]
            {
                new LifecycleRule
                {
                    Expiration = Duration.Days(7),
                    AbortIncompleteMultipartUploadAfter = Duration.Days(1)
                }
            }
        });

        // ── API Lambda ───────────────────────────────────────────────────
        var lambdaAssetPath = (string?)this.Node.TryGetContext("lambdaAssetPath")
            ?? "src/Api/bin/Release/net10.0/publish";

        // Projector asset path (27-B). Same context-key indirection as the API asset so
        // the Infrastructure.Assertions tests synth against AppContext.BaseDirectory
        // (a real directory) without a publish; the deploy pipeline publishes the real
        // artifact to the default path before `cdk synth`/`cdk deploy`.
        var projectorAssetPath = (string?)this.Node.TryGetContext("projectorAssetPath")
            ?? "src/Projector/bin/Release/net10.0/publish";

        // Batch-diarization completion Lambda asset (33-B1). Same context-key indirection so the
        // Infrastructure.Assertions tests synth against a real directory without a publish.
        var transcribeCompletionAssetPath = (string?)this.Node.TryGetContext("transcribeCompletionAssetPath")
            ?? "src/TranscribeCompletion/bin/Release/net10.0/publish";

        // Explicit log groups so retention is managed (and cost-bounded) rather
        // than letting the runtime auto-create an unmanaged, never-expiring group.
        // 27-D: the single request Lambda is split into a Command and a Query function,
        // each with its own log group so a write-path error and a read-path error are
        // separable at a glance.
        var commandLogGroup = new Amazon.CDK.AWS.Logs.LogGroup(this, "CommandFunctionLogGroup", new Amazon.CDK.AWS.Logs.LogGroupProps
        {
            Retention = Amazon.CDK.AWS.Logs.RetentionDays.ONE_MONTH,
            RemovalPolicy = RemovalPolicy.DESTROY
        });
        var queryLogGroup = new Amazon.CDK.AWS.Logs.LogGroup(this, "QueryFunctionLogGroup", new Amazon.CDK.AWS.Logs.LogGroupProps
        {
            Retention = Amazon.CDK.AWS.Logs.RetentionDays.ONE_MONTH,
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        // Production Bedrock model for transcript analysis. Single source of truth:
        // drives both the Lambda's BEDROCK_MODEL_ID env var and the InvokeModel IAM
        // scope below. To switch the prod model after an eval run, change the default
        // literal here and deploy (the decision is recorded in docs/eval-runs/). An
        // optional BEDROCK_MODEL_ID override is still honoured if ever set.
        var bedrockModelId = string.IsNullOrEmpty(props.BedrockModelId)
            ? "amazon.nova-lite-v1:0"
            : props.BedrockModelId;

        // Shared request-environment for both the Command and Query functions. They run
        // the SAME binary (Handler "Api"); the split is enforced by API Gateway routing
        // and per-function IAM, not by mapping different endpoints. So both need the full
        // env — Program.cs/Builder require every table name at boot, and auth/allowlist
        // run on every request (including reads). A table name in the env without the
        // matching IAM grant is inert: the Query function never calls the tables it cannot
        // read. Token-resolved env (TRANSCRIBE_ROLE_ARN) is added per-function below.
        var requestEnvironment = new Dictionary<string, string>
        {
            // Defensive: with active tracing the Lambda runtime always provides a
            // segment, but log rather than throw if the X-Ray context is ever absent.
            ["AWS_XRAY_CONTEXT_MISSING"] = "LOG_ERROR",
            // 35-E: the MCP endpoint is re-enabled in prod WITH OAuth in place (the Resource Server
            // rejects any request without a valid audience-bound bearer). It is never live without auth.
            ["MCP_ENABLED"] = "true",
            ["EVENTS_TABLE_NAME"] = eventsTable.TableName,
            ["PROJ_NOTETITLELIST_TABLE_NAME"] = projTable.TableName,
            ["PROJ_NOTEDETAIL_TABLE_NAME"] = noteDetailTable.TableName,
            ["PROJ_NOTEACTIONS_TABLE_NAME"] = noteActionsTable.TableName,
            ["PROJ_TODOLIST_TABLE_NAME"] = todoListTable.TableName,
            ["PROJ_NOTECARDLIST_TABLE_NAME"] = noteCardListTable.TableName,
            ["PROJ_FOLDERTREE_TABLE_NAME"] = folderTreeTable.TableName,
            ["PROJ_TAGINDEX_TABLE_NAME"] = tagIndexTable.TableName,
            ["PROJ_TAGFEEDBACK_TABLE_NAME"] = tagFeedbackTable.TableName,
            ["PROJ_ACTIONFEEDBACK_TABLE_NAME"] = actionFeedbackTable.TableName,
            // Always present even when unset so runtime code reads "" rather than throwing on missing key.
            // Use string.IsNullOrEmpty() on the consumer side; the key itself is always there.
            ["GOOGLE_CLIENT_ID"] = props.GoogleClientId ?? "",
            ["GOOGLE_CLIENT_SECRET"] = props.GoogleClientSecret ?? "",
            ["ALLOWED_USER_SUBS"] = props.AllowedUserSubs ?? "",
            // 34-D: the calendar SSM fallback + CALENDAR_PROVIDER are retired — calendars are fully
            // in-app per workspace. MS_CLIENT_ID/MS_TENANT_ID stay (the in-app Outlook OAuth + Graph
            // token exchange). Public client, no secret.
            ["MS_CLIENT_ID"] = props.MicrosoftClientId ?? "",
            ["MS_TENANT_ID"] = props.MicrosoftTenantId ?? "",
            ["PROJ_CALENDARLINKINDEX_TABLE_NAME"] = calendarLinkIndexTable.TableName,
            ["PROJ_NOTESEARCHVIEW_TABLE_NAME"] = noteSearchViewTable.TableName,
            ["DRAFT_TRANSCRIPTION_TABLE_NAME"] = draftTranscriptionTable.TableName,
            ["AUTH_TOKENS_TABLE_NAME"] = authTokensTable.TableName,
            ["CALENDAR_TOKENS_TABLE_NAME"] = calendarTokensTable.TableName,
            // 35-E MCP OAuth broker: the two store table names + the signing-secret NAME (never the
            // value) + the issuer/client config. All ride the constructor dict so they are part of the
            // function-config hash (CurrentVersion), matching the env-var-on-constructor-dict guardrail.
            ["MCP_AUTH_CODE_TABLE_NAME"] = mcpAuthCodeTable.TableName,
            ["MCP_REFRESH_TOKEN_TABLE_NAME"] = mcpRefreshTokenTable.TableName,
            ["MCP_JWT_SECRET_NAME"] = mcpJwtSecret.SecretName,
            ["MCP_OAUTH_ISSUER"] = props.McpOAuthIssuer ?? "",
            ["MCP_OAUTH_CLIENT_ID"] = props.McpOAuthClientId ?? "",
            ["IMAGE_BUCKET_NAME"] = imagesBucket.BucketName,
            ["RECORDINGS_BUCKET_NAME"] = recordingsBucket.BucketName,
            ["PROJ_WORKSPACELIST_TABLE_NAME"] = workspaceListTable.TableName,
            // RYW-1: the consistency gate reads the projector's processed-position table to
            // wait until a just-written stream has been applied. Rides the constructor dict
            // (projPositionTable is created above the function), not AddEnvironment, so it is
            // included in the function-config hash that drives the CurrentVersion alias.
            ["PROJ_POSITION_TABLE_NAME"] = projPositionTable.TableName,
            ["BEDROCK_MODEL_ID"] = bedrockModelId
        };

        // ── Command function (writes + side services + admin rebuild) ────────
        // Serves every write method (POST/PUT/PATCH/DELETE) plus the two side-service
        // GETs (calendar, transcribe credentials) that need Google/SSM/STS rather than a
        // projection. Invoked via $LATEST (no alias) — writes are masked by the frontend's
        // optimistic UI, so this function pays NO SnapStart snapshot cost (the deploy-time
        // guardrail: only the Query function's SnapStart publish remains, keeping per-deploy
        // time neutral). 512 MB matches the read function for parity.
        var commandFunction = new Amazon.CDK.AWS.Lambda.Function(this, "CommandFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "Api",
            Description = "AI Note Taker Command API",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(lambdaAssetPath),
            Timeout = Duration.Seconds(29),
            MemorySize = 512,
            LogGroup = commandLogGroup,
            Tracing = Amazon.CDK.AWS.Lambda.Tracing.ACTIVE,
            Environment = new Dictionary<string, string>(requestEnvironment)
        });

        // ── Transcribe browser role ──────────────────────────────────────
        // Scoped role the Lambda issues to the browser via STS AssumeRole.
        // Trust policy allows only this Lambda's execution role to assume it.
        // Defined before the alias so that AddEnvironment is called before
        // CurrentVersion is first accessed; CDK v2 hashes function configuration
        // at that point, and env vars set afterwards are excluded from the hash.
        var transcribeRole = new Role(this, "TranscribeBrowserRole", new RoleProps
        {
            AssumedBy = new ArnPrincipal(commandFunction.Role!.RoleArn),
            Description = "Scoped credentials for browser-held AWS Transcribe Streaming sessions",
            InlinePolicies = new Dictionary<string, PolicyDocument>
            {
                ["TranscribeStreamingOnly"] = new PolicyDocument(new PolicyDocumentProps
                {
                    Statements = new[]
                    {
                        new PolicyStatement(new PolicyStatementProps
                        {
                            // Both actions are required: the HTTP/2 variant and the WebSocket
                            // variant used by @aws-sdk/client-transcribe-streaming in browsers.
                            Actions = new[]
                            {
                                "transcribe:StartStreamTranscription",
                                "transcribe:StartStreamTranscriptionWebSocket"
                            },
                            Resources = new[] { "*" }
                        })
                    }
                })
            }
        });
        commandFunction.AddToRolePolicy(new PolicyStatement(new PolicyStatementProps
        {
            Actions = new[] { "sts:AssumeRole" },
            Resources = new[] { transcribeRole.RoleArn }
        }));
        // TRANSCRIBE_ROLE_ARN is a token (role ARN) and is read lazily only by the
        // transcribe-credentials endpoint (a Command-routed GET) — so it rides AddEnvironment
        // on the Command function alone; the Query function never serves that route.
        commandFunction.AddEnvironment("TRANSCRIBE_ROLE_ARN", transcribeRole.RoleArn);

        // Cross-region inference profiles (eu./us./ap. prefix) require two IAM ARNs:
        //   - inference-profile: includes account ID, scoped to the deployment region
        //   - foundation-model:  no account ID, wildcard region (Bedrock routes internally)
        // Direct foundation model IDs only need the foundation-model ARN (no account ID).
        string[] bedrockResources;
        if (bedrockModelId.Length > 3 && bedrockModelId[2] == '.')
        {
            var baseModelId = bedrockModelId[3..];
            bedrockResources =
            [
                Arn.Format(new ArnComponents { Service = "bedrock", Resource = "inference-profile", ResourceName = bedrockModelId }, this),
                $"arn:aws:bedrock:*::foundation-model/{baseModelId}"
            ];
        }
        else
        {
            bedrockResources =
            [
                Arn.Format(new ArnComponents { Service = "bedrock", Resource = "foundation-model", ResourceName = bedrockModelId, Account = string.Empty }, this)
            ];
        }
        commandFunction.AddToRolePolicy(new PolicyStatement(new PolicyStatementProps
        {
            Actions = new[] { "bedrock:InvokeModel" },
            Resources = bedrockResources
        }));
        // Note images: object read/write scoped to the note image prefix. Uses the
        // bucket grant (not a bespoke AddToRolePolicy statement) as a matter of habit.
        imagesBucket.GrantReadWrite(commandFunction, "notes/*");
        // Call recordings (33-A): object read/write scoped to the recordings prefix. Presign
        // upload/download + the save command all run on the Command function. Resource-grant
        // path (never a bespoke AddToRolePolicy — see the CurrentVersion-hash guardrail).
        recordingsBucket.GrantReadWrite(commandFunction, "recordings/*");
        // Batch diarization trigger (33-B1): the diarize endpoint starts a Transcribe batch job.
        // No DataAccessRole is passed, so Transcribe reads the input WAV and writes the result JSON
        // (under recordings/transcripts/, covered by the grant above) as THIS function's identity.
        // Scoped to our diarization job-name prefix (least privilege). Added as a DEDICATED policy
        // resource rather than commandFunction.AddToRolePolicy: the role's auto-generated
        // DefaultPolicy is already at the 6144-byte size limit, so growing it splits statements into
        // an overflow ManagedPolicy (which shuffles unrelated grants between resources and breaks the
        // SSM/Bedrock template assertions). A standalone Policy keeps DefaultPolicy — and every
        // existing grant assertion — unchanged.
        new Policy(this, "CommandStartTranscriptionPolicy", new PolicyProps
        {
            Roles = new[] { commandFunction.Role! },
            Statements = new[]
            {
                new PolicyStatement(new PolicyStatementProps
                {
                    Actions = new[] { "transcribe:StartTranscriptionJob" },
                    Resources = new[]
                    {
                        Arn.Format(new ArnComponents { Service = "transcribe", Resource = "transcription-job", ResourceName = "diarize-*" }, this)
                    }
                })
            }
        });

        // The Command function is invoked via $LATEST (no alias) — it has no SnapStart,
        // so there is no published-version snapshot to route to. Dropping the alias also
        // removes the CurrentVersion-hash freeze, so the conditional SSM grant below can no
        // longer be silently excluded from a version's config.
        eventsTable.GrantReadWriteData(commandFunction);
        eventsTable.Grant(commandFunction, "dynamodb:TransactWriteItems");
        // Projection tables: read/write. Since RYW the command handlers are append-only and
        // do NOT touch projections — these grants exist SOLELY for the admin rebuild endpoint
        // (POST /admin/projections/rebuild), which folds the event log and rewrites every read
        // model. This is the documented "admin grant" exception (ADR 0009 / phase-27): the
        // Command role's only projection access is the rebuild maintenance path, not request
        // handling. The Query (read) role holds these tables read-only.
        projTable.GrantReadWriteData(commandFunction);
        noteDetailTable.GrantReadWriteData(commandFunction);
        noteActionsTable.GrantReadWriteData(commandFunction);
        todoListTable.GrantReadWriteData(commandFunction);
        noteCardListTable.GrantReadWriteData(commandFunction);
        folderTreeTable.GrantReadWriteData(commandFunction);
        tagIndexTable.GrantReadWriteData(commandFunction);
        tagFeedbackTable.GrantReadWriteData(commandFunction);
        actionFeedbackTable.GrantReadWriteData(commandFunction);
        calendarLinkIndexTable.GrantReadWriteData(commandFunction);
        noteSearchViewTable.GrantReadWriteData(commandFunction);
        workspaceListTable.GrantReadWriteData(commandFunction);
        // No proj-position grant on Command: writes don't gate, and the rebuild handler does
        // not touch the cursor table. The read-your-writes gate (which reads proj-position)
        // runs only on GET handlers, which route to the Query function.
        // Least-privilege: the draft store only ever does point Get/Put/Delete.
        draftTranscriptionTable.Grant(commandFunction, "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem");
        // Auth refresh-token store (30-A): only the Command Lambda touches it (the /auth/*
        // endpoints route there). Resource-grant path, RW; the Query Lambda gets NO grant.
        authTokensTable.GrantReadWriteData(commandFunction);
        calendarTokensTable.GrantReadWriteData(commandFunction);
        // 35-E: the AS broker (authorize/callback/token) runs on Command — it writes/reads the auth-code
        // + refresh-token stores and SIGNS access tokens with the HMAC secret. Resource grants (not
        // AddToRolePolicy) so they route through role.addToPrincipalPolicy.
        mcpAuthCodeTable.GrantReadWriteData(commandFunction);
        mcpRefreshTokenTable.GrantReadWriteData(commandFunction);
        mcpJwtSecret.GrantRead(commandFunction);

        // 34-D: the calendar SSM grants are fully retired (both Google and Microsoft are in-app), so
        // the command function holds no ssm:GetParameter grant.

        // ── Query function (reads only — projection tables read-only) ────────
        // Serves every GET except the two side-service GETs pinned to Command. Keeps
        // SnapStart (latency-critical, user-facing reads) behind a `live` alias. Its role
        // is the load-bearing least-privilege boundary: read-only on the projection tables
        // it serves + the proj-position cursor (the read-your-writes gate) + a point read on
        // the draft store (GET /notes/{id} composes an uncommitted draft) + a metadata-only
        // DescribeTable on the events table (the /health probe). It can NEVER mutate any item
        // and has NO event-store data access, no Bedrock/STS/SSM/Google, no image-bucket grant.
        var queryFunction = new Amazon.CDK.AWS.Lambda.Function(this, "QueryFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "Api",
            Description = "AI Note Taker Query API",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(lambdaAssetPath),
            Timeout = Duration.Seconds(29),
            MemorySize = 512,
            LogGroup = queryLogGroup,
            SnapStart = Amazon.CDK.AWS.Lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
            Tracing = Amazon.CDK.AWS.Lambda.Tracing.ACTIVE,
            Environment = new Dictionary<string, string>(requestEnvironment)
        });

        var queryAlias = new Amazon.CDK.AWS.Lambda.Alias(this, "QueryFunctionLiveAlias", new Amazon.CDK.AWS.Lambda.AliasProps
        {
            AliasName = "live",
            Version = queryFunction.CurrentVersion
        });

        // Read-only projection grants — exactly the read models the GET handlers serve.
        // The feedback counter tables (tag/action) are deliberately excluded: they are
        // projector-written and read only on the analysis (write) path, never on a GET.
        projTable.GrantReadData(queryFunction);
        noteDetailTable.GrantReadData(queryFunction);
        noteActionsTable.GrantReadData(queryFunction);
        todoListTable.GrantReadData(queryFunction);
        noteCardListTable.GrantReadData(queryFunction);
        folderTreeTable.GrantReadData(queryFunction);
        tagIndexTable.GrantReadData(queryFunction);
        calendarLinkIndexTable.GrantReadData(queryFunction);
        noteSearchViewTable.GrantReadData(queryFunction);
        workspaceListTable.GrantReadData(queryFunction);
        // The read-your-writes gate polls the projector's processed-position cursor.
        projPositionTable.GrantReadData(queryFunction);
        // GET /notes/{id} composes the uncommitted transcription draft at read time.
        draftTranscriptionTable.Grant(queryFunction, "dynamodb:GetItem");
        // /health probes DynamoDB reachability via DescribeTable on the events table —
        // a control-plane metadata call only; it grants no access to event-store DATA.
        eventsTable.Grant(queryFunction, "dynamodb:DescribeTable");
        // 35-E: the MCP tool path is on Query, so the Resource Server VALIDATES the HS256 token here —
        // it needs to read (never write) the same HMAC secret Command signs with. Resource grant only;
        // Query gets NO access to the OAuth code/refresh tables (it never runs the AS flow).
        mcpJwtSecret.GrantRead(queryFunction);

        // ── Projector Lambda (27-B → 27-RYW: sole read-model writer) ─────────────────────────
        // Async read-model writer driven by the events-table DynamoDB stream. Mirrors the
        // API Lambda's runtime/tracing but is an async throughput consumer, not a request
        // handler: NO SnapStart and NO alias (cold-start latency is irrelevant off the
        // request path, and an alias would couple the ESM to a published version). All
        // table/bucket names ride the constructor Environment dict so they are part of the
        // hashed config. Since Phase 27-RYW the command handlers are append-only, so this
        // projector is the SOLE writer of every read model; reads get read-your-writes by
        // waiting on its proj-position (the ConsistencyGate).
        var projectorLogGroup = new Amazon.CDK.AWS.Logs.LogGroup(this, "ProjectorFunctionLogGroup", new Amazon.CDK.AWS.Logs.LogGroupProps
        {
            Retention = Amazon.CDK.AWS.Logs.RetentionDays.ONE_MONTH,
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        var projectorFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ProjectorFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "Projector::Projector.ProjectorFunction::Handle",
            Description = "AI Note Taker async projector (DynamoDB stream → read models)",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(projectorAssetPath),
            // Folds events through the same projection stores as the write path; 60s/512MB
            // gives headroom for a re-fold of a long stream without the 29s request cap.
            Timeout = Duration.Seconds(60),
            MemorySize = 512,
            LogGroup = projectorLogGroup,
            Tracing = Amazon.CDK.AWS.Lambda.Tracing.ACTIVE,
            Environment = new Dictionary<string, string>
            {
                ["AWS_XRAY_CONTEXT_MISSING"] = "LOG_ERROR",
                ["EVENTS_TABLE_NAME"] = eventsTable.TableName,
                ["PROJ_NOTETITLELIST_TABLE_NAME"] = projTable.TableName,
                ["PROJ_NOTEDETAIL_TABLE_NAME"] = noteDetailTable.TableName,
                ["PROJ_NOTEACTIONS_TABLE_NAME"] = noteActionsTable.TableName,
                ["PROJ_TODOLIST_TABLE_NAME"] = todoListTable.TableName,
                ["PROJ_NOTECARDLIST_TABLE_NAME"] = noteCardListTable.TableName,
                ["PROJ_FOLDERTREE_TABLE_NAME"] = folderTreeTable.TableName,
                ["PROJ_TAGINDEX_TABLE_NAME"] = tagIndexTable.TableName,
                ["PROJ_TAGFEEDBACK_TABLE_NAME"] = tagFeedbackTable.TableName,
                ["PROJ_ACTIONFEEDBACK_TABLE_NAME"] = actionFeedbackTable.TableName,
                ["PROJ_CALENDARLINKINDEX_TABLE_NAME"] = calendarLinkIndexTable.TableName,
                ["PROJ_NOTESEARCHVIEW_TABLE_NAME"] = noteSearchViewTable.TableName,
                ["PROJ_WORKSPACELIST_TABLE_NAME"] = workspaceListTable.TableName,
                ["PROJ_POSITION_TABLE_NAME"] = projPositionTable.TableName,
                ["IMAGE_BUCKET_NAME"] = imagesBucket.BucketName
            }
        });

        // Least-privilege projector role (resource-GrantX path only — never a bare
        // AddToRolePolicy, which can silently drop a conditional post-CurrentVersion grant):
        //  - projection tables: read/write (it writes the read models),
        //  - events table: stream-read + read-only (re-fold a stream) — NOT write,
        //  - position guard table: read/write (the processed-position cursor),
        //  - DLQ: send (the ESM on-failure destination),
        //  - image bucket: delete only, scoped to notes/* (the NoteDeleted purge path).
        // The events-table read-without-write boundary is the load-bearing assertion:
        // the projector can fold the log but can never append to it.
        projTable.GrantReadWriteData(projectorFunction);
        noteDetailTable.GrantReadWriteData(projectorFunction);
        noteActionsTable.GrantReadWriteData(projectorFunction);
        todoListTable.GrantReadWriteData(projectorFunction);
        noteCardListTable.GrantReadWriteData(projectorFunction);
        folderTreeTable.GrantReadWriteData(projectorFunction);
        tagIndexTable.GrantReadWriteData(projectorFunction);
        tagFeedbackTable.GrantReadWriteData(projectorFunction);
        actionFeedbackTable.GrantReadWriteData(projectorFunction);
        calendarLinkIndexTable.GrantReadWriteData(projectorFunction);
        noteSearchViewTable.GrantReadWriteData(projectorFunction);
        workspaceListTable.GrantReadWriteData(projectorFunction);
        projPositionTable.GrantReadWriteData(projectorFunction);
        eventsTable.GrantStreamRead(projectorFunction);
        eventsTable.GrantReadData(projectorFunction);
        projectorDlq.GrantSendMessages(projectorFunction);
        // For the NoteDeleted image-purge path. The projector is the sole writer (since 27-RYW), so
        // it owns the image purge on a delete. PurgeNoteAsync LISTS the note's objects then DELETEs
        // them, so it needs s3:ListBucket (+GetObject) AND s3:DeleteObject — GrantDelete alone omits
        // ListBucket, which made every delete-purge fail AccessDenied in prod (BUG-29). GrantRead
        // supplies List+Get; the existing GrantDelete supplies Delete. S3 delete is idempotent.
        imagesBucket.GrantRead(projectorFunction, "notes/*");
        imagesBucket.GrantDelete(projectorFunction, "notes/*");

        // DynamoDB event-source mapping: TRIM_HORIZON so the projector folds the full
        // existing log on first deploy; bisect-on-error + bounded retries + max record
        // age so one poison record can't wedge the shard, and the on-failure DLQ catches
        // what survives retry. ParallelizationFactor 1 keeps per-key ordering simple.
        // Stream trigger ENABLED: since Phase 27-RYW the projector is the SOLE async writer of
        // every read model — all flows (todos, notes, actions, folders, workspaces) are migrated
        // and their command handlers are append-only — and reads get read-your-writes by waiting on
        // proj-position (the ConsistencyGate). The transient feedback double-count (inline +1,
        // projector +1) that existed mid-migration closed when the last inline write was removed.
        // See ADR 0009 and docs/phases/phase-27-ryw.md.
        projectorFunction.AddEventSource(new Amazon.CDK.AWS.Lambda.EventSources.DynamoEventSource(eventsTable, new Amazon.CDK.AWS.Lambda.EventSources.DynamoEventSourceProps
        {
            Enabled = true,
            StartingPosition = Amazon.CDK.AWS.Lambda.StartingPosition.TRIM_HORIZON,
            BatchSize = 10,
            BisectBatchOnError = true,
            RetryAttempts = 3,
            MaxRecordAge = Duration.Hours(24),
            ParallelizationFactor = 1,
            OnFailure = new Amazon.CDK.AWS.Lambda.EventSources.SqsDlq(projectorDlq)
        }));

        // ── Transcribe batch-diarization completion Lambda (33-B1) ───────────
        // Dedicated non-HTTP handler for the EventBridge "Transcribe Job State Change" rule. On a
        // COMPLETED job it fetches the result, parses speaker turns and APPENDS TranscriptionDiarized
        // (replacing the streamed transcript); on FAILED/empty/poison it leaves the streamed transcript
        // intact and emits a failure metric. Modelled on the Projector host but with the opposite
        // event-store boundary: it must WRITE the log (append the diarized event), so it gets
        // GrantReadWriteData + TransactWriteItems — not the projector's read-only stance.
        var transcribeCompletionLogGroup = new Amazon.CDK.AWS.Logs.LogGroup(this, "TranscribeCompletionFunctionLogGroup", new Amazon.CDK.AWS.Logs.LogGroupProps
        {
            Retention = Amazon.CDK.AWS.Logs.RetentionDays.ONE_MONTH,
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        var transcribeCompletionFunction = new Amazon.CDK.AWS.Lambda.Function(this, "TranscribeCompletionFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "TranscribeCompletion::TranscribeCompletion.TranscribeCompletionFunction::Handle",
            Description = "AI Note Taker batch-diarization completion (Transcribe job → diarized transcript)",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(transcribeCompletionAssetPath),
            // GetTranscriptionJob + S3 result fetch + parse + append; 60s/512MB gives headroom over
            // the 29s request cap for a large result JSON.
            Timeout = Duration.Seconds(60),
            MemorySize = 512,
            LogGroup = transcribeCompletionLogGroup,
            Tracing = Amazon.CDK.AWS.Lambda.Tracing.ACTIVE,
            Environment = new Dictionary<string, string>
            {
                ["AWS_XRAY_CONTEXT_MISSING"] = "LOG_ERROR",
                ["EVENTS_TABLE_NAME"] = eventsTable.TableName,
                // 33-B2: the re-analysis graph needs the Bedrock model + the read-model tables it
                // reads as analysis input (content/tags/existing actions; the hot diarized transcript
                // is passed in, not read).
                ["BEDROCK_MODEL_ID"] = bedrockModelId,
                ["PROJ_NOTEDETAIL_TABLE_NAME"] = noteDetailTable.TableName,
                ["PROJ_NOTEACTIONS_TABLE_NAME"] = noteActionsTable.TableName
            }
        });

        // Least-privilege completion role (resource-GrantX path for everything scopable):
        //  - events table: read + WRITE (loads the stream, appends TranscriptionDiarized via a
        //    TransactWriteItems optimistic-concurrency append — same as the Command function),
        //  - recordings bucket: read-only on recordings/* (fetch the result JSON the job wrote),
        //  - transcribe:GetTranscriptionJob: not resource-scopable → a single AddToRolePolicy on a
        //    no-alias function (no CurrentVersion freeze).
        eventsTable.GrantReadWriteData(transcribeCompletionFunction);
        eventsTable.Grant(transcribeCompletionFunction, "dynamodb:TransactWriteItems");
        recordingsBucket.GrantRead(transcribeCompletionFunction, "recordings/*");
        transcribeCompletionFunction.AddToRolePolicy(new PolicyStatement(new PolicyStatementProps
        {
            Actions = new[] { "transcribe:GetTranscriptionJob" },
            Resources = new[] { "*" }
        }));
        // 33-B2 re-analysis: read the note's content/tags (NoteDetail) and existing actions
        // (NoteActions) projections as analysis input, and invoke Bedrock. InvokeModel is added as a
        // DEDICATED Policy (the same bedrockResources scope the Command function uses) rather than
        // AddToRolePolicy, so the role's DefaultPolicy stays small and the GetTranscriptionJob
        // assertion can't be shuffled into an overflow ManagedPolicy.
        noteDetailTable.GrantReadData(transcribeCompletionFunction);
        noteActionsTable.GrantReadData(transcribeCompletionFunction);
        new Policy(this, "TranscribeCompletionBedrockPolicy", new PolicyProps
        {
            Roles = new[] { transcribeCompletionFunction.Role! },
            Statements = new[]
            {
                new PolicyStatement(new PolicyStatementProps
                {
                    Actions = new[] { "bedrock:InvokeModel" },
                    Resources = bedrockResources
                })
            }
        });

        // EventBridge rule: Transcribe emits a "Transcribe Job State Change" event when a batch job
        // settles. Filter to terminal states so the handler only runs once per job (COMPLETED →
        // diarize; FAILED → record failure, keep streamed transcript). The job-name prefix
        // (diarize-…) is re-checked in the handler, so a non-diarization job is ignored cheaply.
        new Amazon.CDK.AWS.Events.Rule(this, "TranscribeJobStateChangeRule", new Amazon.CDK.AWS.Events.RuleProps
        {
            Description = "Route completed/failed Transcribe batch jobs to the diarization completion Lambda",
            EventPattern = new Amazon.CDK.AWS.Events.EventPattern
            {
                Source = new[] { "aws.transcribe" },
                DetailType = new[] { "Transcribe Job State Change" },
                Detail = new Dictionary<string, object>
                {
                    ["TranscriptionJobStatus"] = new[] { "COMPLETED", "FAILED" }
                }
            },
            Targets = new[] { new Amazon.CDK.AWS.Events.Targets.LambdaFunction(transcribeCompletionFunction) }
        });

        // ── API Gateway ──────────────────────────────────────────────────
        // CORS is handled by ASP.NET Core UseCors middleware in the Lambda, not at
        // the API Gateway level. API Gateway's CorsPreflight + a /{proxy+} ANY catch-all
        // produces a 405 for OPTIONS preflight because the two conflict; removing it lets
        // OPTIONS flow through to Lambda where UseCors returns 200 with the right headers.
        var httpApi = new Amazon.CDK.AWS.Apigatewayv2.HttpApi(this, "HttpApi", new Amazon.CDK.AWS.Apigatewayv2.HttpApiProps
        {
            ApiName = "notetaker-api",
        });

        // 27-D: route by method. Reads (GET/HEAD) + CORS preflight (OPTIONS) go to the
        // Query function; write methods go to Command. Two side-service GETs are pinned to
        // Command (more-specific routes beat the greedy /{proxy+}) because they need
        // Google/SSM (calendar) or STS (transcribe credentials), not a projection.
        var commandIntegration = new Amazon.CDK.AwsApigatewayv2Integrations.HttpLambdaIntegration(
            "CommandIntegration", commandFunction);
        var queryIntegration = new Amazon.CDK.AwsApigatewayv2Integrations.HttpLambdaIntegration(
            "QueryIntegration", queryAlias);

        // Reads + preflight → Query. HTTP API's ANY does not include OPTIONS, so OPTIONS is
        // routed explicitly (ASP.NET Core UseCors handles the preflight in either binary).
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/{proxy+}",
            Methods = new[]
            {
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.GET,
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.HEAD,
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.OPTIONS
            },
            Integration = queryIntegration
        });

        // Writes → Command.
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/{proxy+}",
            Methods = new[]
            {
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.POST,
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.PUT,
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.PATCH,
                Amazon.CDK.AWS.Apigatewayv2.HttpMethod.DELETE
            },
            Integration = commandIntegration
        });

        // Side-service GETs that need write-path credentials, not projections → Command.
        // 34-B: calendar reads are now workspace-scoped under `/w/{workspaceId}/calendar/...`, so the
        // pins move to the prefixed paths (the bare `/calendar/...` routes no longer exist). The
        // meetings GET needs the Google/SSM-backed ICalendarClient; the connection GET hits the
        // calendar-token store — both granted to Command, not Query.
        // NOTE (deploy ordering): these route pins are part of the backend artifact, so they only
        // reach prod via a `cdk deploy` (detect-changes backend=true). The matching frontend change
        // (the api client now sends `/w/{wsId}/calendar/...`) ships independently as a web asset, so
        // a deploy that carries the frontend but skips the backend leaves the new calls hitting the
        // generic `/{proxy+}`→Query route (404). Frontend and these pins must land in the SAME
        // backend deploy — see docs/learnings/phase-34b-workspace-calendar.md.
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/w/{workspaceId}/calendar/{date}",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.GET },
            Integration = commandIntegration
        });
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/w/{workspaceId}/calendar/connection",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.GET },
            Integration = commandIntegration
        });
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/transcription/credentials",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.GET },
            Integration = commandIntegration
        });

        // 35-A: the MCP tool-call path is JSON-RPC over POST but READ-ONLY (it reads the
        // NoteCardList projection only), so it must hit the Query Lambda — overriding the default
        // POST→Command routing above. Pinned to Query like the calendar GETs are pinned to Command.
        // This pin is a backend artifact: it reaches prod only via a `cdk deploy` (backend=true).
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/w/{workspaceId}/mcp",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.POST },
            Integration = queryIntegration
        });

        // 35-E: the OAuth Authorization-Server endpoints need the Google client + the HMAC secret +
        // the auth-code/refresh stores, which only the Command function holds — so they are pinned to
        // Command (mirrors the calendar GETs). The token endpoint is a POST (default → Command anyway,
        // but pinned explicitly for clarity); authorize/callback/AS-metadata are GETs that would
        // otherwise fall to Query. The protected-resource metadata (`/.well-known/oauth-protected-
        // resource…`, a GET served by the MCP SDK) and the `/w/{ws}/mcp` tool path stay on Query.
        // This whole route group is a BACKEND artifact: it reaches prod only via a `cdk deploy`
        // (detect-changes backend=true). A frontend-only deploy that skips the backend would leave a
        // new request path falling through to `/{proxy+}` → 404 (route-contract guardrail).
        foreach (var oauthGet in new[] { "/oauth/authorize", "/oauth/google/callback", "/.well-known/oauth-authorization-server" })
        {
            httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
            {
                Path = oauthGet,
                Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.GET },
                Integration = commandIntegration
            });
        }
        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/oauth/token",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.POST },
            Integration = commandIntegration
        });

        // ── Frontend (S3 + CloudFront) ───────────────────────────────────
        var webBucket = new Bucket(this, "WebBucket", new BucketProps
        {
            RemovalPolicy = RemovalPolicy.RETAIN,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            AutoDeleteObjects = false,
            // Zero-downtime deploy (Phase 26-A): the deploy no longer `s3 sync --delete`s
            // superseded hashed bundles, so a browser/CDN still holding the previous
            // index.html keeps finding its assets. They are reaped here instead, 30 days
            // after they stop being re-uploaded. Scoped to `assets/` (Vite's hashed-asset
            // dir) so index.html and other unhashed root objects are never expired.
            // A still-referenced asset is re-synced from a fresh build each deploy, which
            // refreshes its LastModified, so it never ages into the window while live.
            LifecycleRules = new[]
            {
                new LifecycleRule
                {
                    Id = "expire-superseded-assets",
                    Enabled = true,
                    Prefix = "assets/",
                    Expiration = Duration.Days(30)
                }
            }
        });

        var distribution = new Distribution(this, "WebDistribution", BuildDistributionProps(props, httpApi, webBucket));

        // ── Route 53 alias (custom domain only) ─────────────────────────
        if (!string.IsNullOrEmpty(props.DomainName) && !string.IsNullOrEmpty(props.HostedZoneId))
        {
            var hostedZone = HostedZone.FromHostedZoneAttributes(this, "HostedZone", new HostedZoneAttributes
            {
                HostedZoneId = props.HostedZoneId,
                ZoneName = DomainHelpers.ApexDomain(props.DomainName)
            });

            new ARecord(this, "AliasRecord", new ARecordProps
            {
                Zone = hostedZone,
                RecordName = props.DomainName,
                Target = RecordTarget.FromAlias(new CloudFrontTarget(distribution))
            });
        }

        // ── Tags ─────────────────────────────────────────────────────────
        Amazon.CDK.Tags.Of(this).Add("Project", "note-taker");

        // ── Outputs ──────────────────────────────────────────────────────
        new CfnOutput(this, "ApiUrl", new CfnOutputProps
        {
            Value = !string.IsNullOrEmpty(props.DomainName)
                ? $"https://{props.DomainName}/api"
                : $"https://{distribution.DistributionDomainName}/api",
            Description = "API endpoint URL"
        });

        new CfnOutput(this, "WebBucketName", new CfnOutputProps
        {
            Value = webBucket.BucketName,
            Description = "S3 bucket for web assets"
        });

        new CfnOutput(this, "WebUrl", new CfnOutputProps
        {
            Value = !string.IsNullOrEmpty(props.DomainName)
                ? $"https://{props.DomainName}"
                : $"https://{distribution.DistributionDomainName}",
            Description = "Frontend URL"
        });

        new CfnOutput(this, "DistributionId", new CfnOutputProps
        {
            Value = distribution.DistributionId,
            Description = "CloudFront distribution ID (used for cache invalidation on deploy)"
        });

        // ── Ops dashboard ────────────────────────────────────────────────
        // One pinned place to answer "is it healthy / what broke / why slow".
        // The errors widget is a Logs Insights query so its time-range picker
        // drives "how far back"; the metric widgets read Lambda/DynamoDB plus the
        // NoteTaker/Domain EMF metrics emitted in 12-B.
        var dashboard = new Amazon.CDK.AWS.CloudWatch.Dashboard(this, "OpsDashboard", new Amazon.CDK.AWS.CloudWatch.DashboardProps
        {
            DashboardName = "notetaker-ops"
        });

        // Domain metrics (12-B) are emitted with dimensions — CommandType/Aggregate
        // plus a "Service" dimension that Powertools adds from the service: argument,
        // not from the dimensions dict. A dimensionless query reads nothing, and a
        // fixed dimension schema is brittle (must list every key, Service included).
        // A free-text SEARCH on namespace+name matches every dimension combination;
        // SUM collapses them into one total line.
        Amazon.CDK.AWS.CloudWatch.IMetric DomainTotal(string metricName) =>
            new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
            {
                Expression = $"SUM(SEARCH('Namespace=\"NoteTaker/Domain\" MetricName=\"{metricName}\"', 'Sum'))",
                Label = metricName,
                Period = Duration.Minutes(5)
            });

        Amazon.CDK.AWS.CloudWatch.IMetric AnalysisDuration(string statistic) =>
            new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "AnalysisDurationMs",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker" },
                Statistic = statistic,
                Period = Duration.Minutes(5)
            });

        dashboard.AddWidgets(
            new Amazon.CDK.AWS.CloudWatch.LogQueryWidget(new Amazon.CDK.AWS.CloudWatch.LogQueryWidgetProps
            {
                Title = "All errors",
                LogGroupNames = new[] { commandLogGroup.LogGroupName, queryLogGroup.LogGroupName },
                Width = 24,
                Height = 6,
                View = Amazon.CDK.AWS.CloudWatch.LogQueryVisualizationType.TABLE,
                // level literals match Powertools' casing ("Error"/"Warning"); the
                // @message regex is the fallback that catches anything else.
                QueryString = string.Join("\n",
                    "fields @timestamp, level, xray_trace_id, message, @message",
                    "| filter level in [\"Error\", \"Warning\"] or @message like /(?i)exception|error|fail/",
                    "| sort @timestamp desc",
                    "| limit 100")
            }),
            // Function-level metrics aggregate across versions/aliases — the right
            // granularity for an ops overview, deliberately not alias-scoped. 27-D: both
            // request functions are plotted so a write-path and a read-path spike are distinct.
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Lambda errors & invocations (command + query)",
                Left = new[]
                {
                    commandFunction.MetricErrors(), commandFunction.MetricInvocations(),
                    queryFunction.MetricErrors(), queryFunction.MetricInvocations()
                },
                Width = 12
            }),
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Lambda duration p50/p99 (command + query)",
                Left = new[]
                {
                    commandFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p50" }),
                    commandFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p99" }),
                    queryFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p50" }),
                    queryFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p99" })
                },
                Width = 12
            }),
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Event store DynamoDB write capacity & errors",
                Left = new[] { eventsTable.MetricConsumedWriteCapacityUnits() },
                Right = new[] { eventsTable.MetricSystemErrorsForOperations() },
                Width = 12
            }),
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Commands handled vs concurrency conflicts",
                Left = new[]
                {
                    DomainTotal("CommandHandled"),
                    DomainTotal("ConcurrencyConflict")
                },
                Width = 12
            }),
            // CHANGE-22: how long analysis takes (p50/p99) + failures.
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Analysis duration p50/p99 vs failures",
                Left = new[]
                {
                    AnalysisDuration("p50"),
                    AnalysisDuration("p99")
                },
                Right = new[] { DomainTotal("AnalysisFailed") },
                Width = 12
            }),
            // 33-B1: batch-diarization jobs completed vs failed (both async — invisible without this).
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Diarization jobs completed vs failed",
                Left = new[]
                {
                    DomainTotal("TranscribeBatchCompleted"),
                    DomainTotal("TranscribeBatchFailed")
                },
                Width = 12
            }));

        new CfnOutput(this, "DashboardUrl", new CfnOutputProps
        {
            Value = $"https://{Region}.console.aws.amazon.com/cloudwatch/home?region={Region}#dashboards:name=notetaker-ops",
            Description = "CloudWatch ops dashboard URL"
        });

        // ── Frontend monitoring (CloudWatch RUM) ─────────────────────────
        // RUM captures JS errors, Core Web Vitals, and failed API calls from
        // real browsers, and (EnableXRay) links a frontend error to its backend
        // trace via the trace id propagated in 12-C. The browser RUM client is
        // anonymous, so it needs temporary AWS creds to call rum:PutRumEvents.
        // CfnAppMonitor does NOT auto-create the Cognito pool/guest-role that the
        // console wizard creates, so we wire them explicitly.
        var rumDomain = !string.IsNullOrEmpty(props.DomainName)
            ? props.DomainName
            : distribution.DistributionDomainName;

        // Used as both the AppMonitor name and the ResourceName the guest-role
        // ARN is built from; the two must stay identical or the role grants
        // rum:PutRumEvents on the wrong ARN and RUM silently drops events.
        const string rumMonitorName = "notetaker-rum";

        var rumIdentityPool = new CfnIdentityPool(this, "RumIdentityPool", new CfnIdentityPoolProps
        {
            AllowUnauthenticatedIdentities = true
        });

        // The guest role's policy references the monitor ARN and the monitor
        // references the role ARN — a cycle. Break it by building the ARN from
        // the fixed monitor name rather than from the L1 attribute.
        var rumMonitorArn = Arn.Format(new ArnComponents
        {
            Service = "rum",
            Resource = "appmonitor",
            ResourceName = rumMonitorName
        }, this);

        var rumGuestRole = new Role(this, "RumGuestRole", new RoleProps
        {
            Description = "Unauthenticated Cognito role allowing the browser RUM client to PutRumEvents",
            AssumedBy = new FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                new Dictionary<string, object>
                {
                    ["StringEquals"] = new Dictionary<string, object>
                    {
                        ["cognito-identity.amazonaws.com:aud"] = rumIdentityPool.Ref
                    },
                    ["ForAnyValue:StringLike"] = new Dictionary<string, object>
                    {
                        ["cognito-identity.amazonaws.com:amr"] = "unauthenticated"
                    }
                },
                "sts:AssumeRoleWithWebIdentity"),
            InlinePolicies = new Dictionary<string, PolicyDocument>
            {
                ["RumPutEvents"] = new PolicyDocument(new PolicyDocumentProps
                {
                    Statements = new[]
                    {
                        new PolicyStatement(new PolicyStatementProps
                        {
                            Actions = new[] { "rum:PutRumEvents" },
                            Resources = new[] { rumMonitorArn }
                        })
                    }
                })
            }
        });

        new CfnIdentityPoolRoleAttachment(this, "RumIdentityPoolRoleAttachment", new CfnIdentityPoolRoleAttachmentProps
        {
            IdentityPoolId = rumIdentityPool.Ref,
            Roles = new Dictionary<string, object>
            {
                ["unauthenticated"] = rumGuestRole.RoleArn
            }
        });

        var rumAppMonitor = new CfnAppMonitor(this, "RumAppMonitor", new CfnAppMonitorProps
        {
            Name = rumMonitorName,
            Domain = rumDomain,
            CwLogEnabled = true,
            AppMonitorConfiguration = new CfnAppMonitor.AppMonitorConfigurationProperty
            {
                AllowCookies = true,
                EnableXRay = true,
                // Learning project: capture every session. Lower this in real prod for cost.
                SessionSampleRate = 1.0,
                Telemetries = new[] { "errors", "performance", "http" },
                IdentityPoolId = rumIdentityPool.Ref,
                GuestRoleArn = rumGuestRole.RoleArn
            }
        });

        // AttrId is the generated AppMonitor GUID the browser snippet needs;
        // Ref would return the monitor name and RUM would silently drop events.
        new CfnOutput(this, "RumMonitorId", new CfnOutputProps
        {
            Value = rumAppMonitor.AttrId,
            Description = "CloudWatch RUM AppMonitor ID (injected into index.html at deploy time)"
        });

        new CfnOutput(this, "RumIdentityPoolId", new CfnOutputProps
        {
            Value = rumIdentityPool.Ref,
            Description = "Cognito identity pool ID for the browser RUM client"
        });

        // ── Alarms + SNS notifications ───────────────────────────────────
        // Turns the ops dashboard from something you remember to check into
        // something that emails you. One topic, three alarms (error rate, P99
        // latency, concurrency-conflict spikes), each wired via an SnsAction.
        // The email address is the only environment-specific value — kept in a
        // single const so it is easy to change.
        const string alarmEmail = "simon.kirkham+note-taker-ai@gmail.com";

        var alarmsTopic = new Amazon.CDK.AWS.SNS.Topic(this, "AlarmsTopic", new Amazon.CDK.AWS.SNS.TopicProps
        {
            TopicName = "notetaker-alarms"
        });
        alarmsTopic.AddSubscription(new Amazon.CDK.AWS.SNS.Subscriptions.EmailSubscription(alarmEmail));

        var alarmAction = new Amazon.CDK.AWS.CloudWatch.Actions.SnsAction(alarmsTopic);

        // Error rate as a percentage of invocations, computed at the alarm so a
        // burst of errors against low traffic still trips. NOT_BREACHING keeps
        // the alarm OK during idle windows where no invocations are recorded.
        // 27-D: error rate across BOTH request functions — a write 500 must page as
        // surely as a read 500. errors/invocations are each a sub-expression summing the
        // command and query functions; the top expression is unchanged.
        var totalErrors = new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
        {
            Expression = "ce + qe",
            UsingMetrics = new Dictionary<string, Amazon.CDK.AWS.CloudWatch.IMetric>
            {
                ["ce"] = commandFunction.MetricErrors(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "Sum" }),
                ["qe"] = queryFunction.MetricErrors(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "Sum" })
            },
            Period = Duration.Minutes(5)
        });
        var totalInvocations = new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
        {
            Expression = "ci + qi",
            UsingMetrics = new Dictionary<string, Amazon.CDK.AWS.CloudWatch.IMetric>
            {
                ["ci"] = commandFunction.MetricInvocations(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "Sum" }),
                ["qi"] = queryFunction.MetricInvocations(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "Sum" })
            },
            Period = Duration.Minutes(5)
        });
        var errorRate = new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
        {
            Expression = "errors / invocations * 100",
            UsingMetrics = new Dictionary<string, Amazon.CDK.AWS.CloudWatch.IMetric>
            {
                ["errors"] = totalErrors,
                ["invocations"] = totalInvocations
            },
            Label = "Error rate (%)",
            Period = Duration.Minutes(5)
        });

        var errorRateAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ErrorRateAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-error-rate",
            AlarmDescription = "Lambda error rate exceeds 1% over 5 minutes",
            Metric = errorRate,
            Threshold = 1,
            EvaluationPeriods = 2,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        errorRateAlarm.AddAlarmAction(alarmAction);

        // 27-D: P99 latency tracks the QUERY function — the user-facing read path (SnapStart,
        // gated reads). Write latency is masked by the frontend's optimistic UI, so it is not
        // the latency signal a user feels; the Command function's health is covered by the
        // error-rate alarm above.
        var latencyAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "LatencyAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-p99-latency",
            AlarmDescription = "Query (read) Lambda P99 duration exceeds 5000 ms over 5 minutes",
            Metric = queryFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions
            {
                Statistic = "p99",
                Period = Duration.Minutes(5)
            }),
            Threshold = 5000,
            EvaluationPeriods = 2,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        latencyAlarm.AddAlarmAction(alarmAction);

        // Projection-rebuild operability (24-C). Both metrics carry only the Powertools
        // Service dimension, so each is a single concrete metric an alarm can target (no
        // SEARCH). A fault means a partial/failed rebuild — degraded read models until a
        // clean re-run — so any occurrence pages. Duration warns when a rebuild creeps
        // toward the 29s HTTP limit (the trigger to move it off the request path).
        var rebuildFaultAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectionRebuildFaultAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projection-rebuild-fault",
            AlarmDescription = "A projection rebuild faulted (partial/failed rebuild) in the last 5 minutes",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "ProjectionRebuildFault",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker" },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 0,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        rebuildFaultAlarm.AddAlarmAction(alarmAction);

        var rebuildDurationAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectionRebuildDurationAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projection-rebuild-duration",
            AlarmDescription = "Projection rebuild duration exceeds 20s, approaching the 29s HTTP limit",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "ProjectionRebuildDuration",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker" },
                Statistic = "Maximum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 20000,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        rebuildDurationAlarm.AddAlarmAction(alarmAction);

        // ── Analysis (Bedrock) alarm (CHANGE-22) ─────────────────────────
        // Analysis runs async to the user's intent (auto-analyse on Stop, later the
        // diarization re-analyse), so a Bedrock failure is otherwise only a 503 the user
        // may not notice. Single dimensionless metric → alarmable; the failing note id is
        // in the structured log, not a dimension.
        var analysisFailedAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "AnalysisFailedAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-analysis-failed",
            AlarmDescription = "A note analysis (Bedrock) failed in the last 5 minutes",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "AnalysisFailed",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker" },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 0,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        analysisFailedAlarm.AddAlarmAction(alarmAction);

        // 33-B1: a batch-diarization job that FAILED (or a fetch/parse error that left the streamed
        // transcript intact) is invisible by construction — the completion Lambda is async (no
        // synchronous 500). TranscribeBatchFailed drives this alarm. Service dimension is
        // note-taker-transcribe (the completion handler's Powertools service).
        var transcribeFailedAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "TranscribeBatchFailedAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-transcribe-failed",
            AlarmDescription = "A batch-diarization job failed or its result could not be applied in the last 5 minutes",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "TranscribeBatchFailed",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker-transcribe" },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 0,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        transcribeFailedAlarm.AddAlarmAction(alarmAction);

        // ── Projector alarms (27-B) ──────────────────────────────────────
        // Async projection failure is invisible by construction (no synchronous 500), so
        // these three are non-negotiable per ADR 0009. Each carries only the Powertools
        // Service dimension (note-taker-projector) so it is a single alarmable metric.
        var projectorErrorAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectorErrorAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projector-error",
            AlarmDescription = "The async projector reported a failure (a record is retrying toward the DLQ) in the last 5 minutes",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "ProjectorFailure",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker-projector" },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 0,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        projectorErrorAlarm.AddAlarmAction(alarmAction);

        // A non-empty DLQ means a record exhausted retries and was parked — read models
        // are now permanently stale for that stream until it is redriven.
        var projectorDlqDepthAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectorDlqDepthAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projector-dlq-depth",
            AlarmDescription = "The projector DLQ holds at least one parked record (a poison event after retry exhaustion)",
            Metric = projectorDlq.MetricApproximateNumberOfMessagesVisible(new Amazon.CDK.AWS.CloudWatch.MetricOptions
            {
                Statistic = "Maximum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 0,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        projectorDlqDepthAlarm.AddAlarmAction(alarmAction);

        // Iterator age is the ESM's "how far behind the stream tip" signal (AWS/Lambda,
        // dimensioned by FunctionName). > 60s means the projector is falling behind faster
        // than it drains — read-after-write lag is growing past what optimistic UI masks.
        var projectorIteratorAgeAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectorIteratorAgeAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projector-iterator-age",
            AlarmDescription = "Projector stream iterator age exceeds 60s — the async projector is falling behind the event log",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "AWS/Lambda",
                MetricName = "IteratorAge",
                DimensionsMap = new Dictionary<string, string> { ["FunctionName"] = projectorFunction.FunctionName },
                Statistic = "Maximum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 60000,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        projectorIteratorAgeAlarm.AddAlarmAction(alarmAction);

        // Projector health on the ops dashboard: lag (now − OccurredAt), applied count,
        // and failures, all SUM(SEARCH(...)) so any dimension combination is captured.
        Amazon.CDK.AWS.CloudWatch.IMetric ProjectorTotal(string metricName, string stat) =>
            new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
            {
                Expression = $"{stat}(SEARCH('Namespace=\"NoteTaker/Domain\" MetricName=\"{metricName}\"', '{stat}'))",
                Label = metricName,
                Period = Duration.Minutes(5)
            });

        dashboard.AddWidgets(
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Projector lag / applied / failures",
                Left = new[]
                {
                    ProjectorTotal("ProjectorApplied", "SUM"),
                    ProjectorTotal("ProjectorFailure", "SUM")
                },
                Right = new[] { ProjectorTotal("ProjectorLag", "MAX") },
                Width = 12
            }));

        // NOTE: a concurrency-conflict alarm is deliberately NOT defined here.
        // ConcurrencyConflict is emitted with per-Aggregate dimensions (plus the
        // Powertools Service dimension), so the only way to aggregate across all
        // aggregates is SUM(SEARCH(...)) — and CloudWatch rejects SEARCH on metric
        // alarms ("SEARCH is not supported on Metric Alarms"). Alarming on it
        // requires first emitting an alarmable (dimensionless or Service-only)
        // ConcurrencyConflict metric; deferred to a follow-up. See phase-12 12-E.

        // ── Unified error view (12-H) ────────────────────────────────────
        // Bring the browser's errors onto the same ops dashboard as the Lambda
        // errors, so one screen (with one time-range picker) answers "what's
        // broken?" across the whole stack. Added as a second AddWidgets call
        // here because rumAppMonitor does not exist when the first batch runs.
        //
        // RUM (CwLogEnabled = true) auto-creates its log group as
        // /aws/vendedlogs/RUMService_notetaker-rum<first-8-of-monitor-GUID>.
        // That suffix is the first hyphen-segment of the monitor GUID, so the
        // name is derivable from AttrId — no hard-coding the environment-specific ID.
        var rumLogGroupName = $"/aws/vendedlogs/RUMService_{rumMonitorName}{Fn.Select(0, Fn.Split("-", rumAppMonitor.AttrId))}";

        // Default RUM metrics publish to AWS/RUM automatically once traffic flows
        // (no CfnMetricsDestination needed); the widget reads whatever RUM emits.
        Amazon.CDK.AWS.CloudWatch.IMetric RumErrorMetric(string metricName) =>
            new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "AWS/RUM",
                MetricName = metricName,
                DimensionsMap = new Dictionary<string, string> { ["application_name"] = rumMonitorName },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            });

        dashboard.AddWidgets(
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                // JsErrorCount also covers failed resource loads (<img>/<script>/<link>
                // 403s etc.): TI-37 forwards them via cwr('recordError'), which RUM
                // counts as a JS error — so no separate metric/widget is needed.
                Title = "Frontend errors (RUM: JS + resource 403s, HTTP)",
                Left = new[]
                {
                    RumErrorMetric("JsErrorCount"),
                    RumErrorMetric("HttpErrorCount")
                },
                Width = 12
            }),
            // Single combined "all errors" table over BOTH log groups. The two
            // sources have different shapes: Powertools backend lines carry
            // level/xray_trace_id/message; RUM events are JSON with the event
            // type com.amazon.rum.js_error_event and the message under
            // event_details. The query matches both with an `or` and surfaces a
            // unified field set, newest first. Time-range picker drives "how far back".
            // Resource-load failures (TI-37) ride the same js_error_event shape — their
            // "Resource load failed: …" message lands here via the js_error_event match.
            new Amazon.CDK.AWS.CloudWatch.LogQueryWidget(new Amazon.CDK.AWS.CloudWatch.LogQueryWidgetProps
            {
                Title = "All errors (backend + frontend)",
                LogGroupNames = new[] { commandLogGroup.LogGroupName, queryLogGroup.LogGroupName, rumLogGroupName },
                Width = 24,
                Height = 6,
                View = Amazon.CDK.AWS.CloudWatch.LogQueryVisualizationType.TABLE,
                QueryString = string.Join("\n",
                    "fields @timestamp, level, xray_trace_id, message, event_details.message, @message",
                    "| filter level in [\"Error\", \"Warning\"] or @message like /com.amazon.rum.js_error_event/ or @message like /(?i)exception|error|fail/",
                    "| sort @timestamp desc",
                    "| limit 100")
            }));

        // ── Saved Logs Insights queries (12-G) ───────────────────────────
        // Persist the runbook's most-used queries so they appear in everyone's
        // Logs Insights query picker under the "NoteTaker/" folder. Field names
        // match the Powertools log shape verified in prod: level / message /
        // xray_trace_id / command_type / stream_id (Powertools emits snake_case).
        // (There is no correlationId log
        // field — x-correlation-id is only a response header; the queryable
        // per-request key is xray_trace_id, set by X-Ray in 12-C.)
        // The "Concurrency conflicts" filter matches the warning the event-store
        // decorator logs ("Concurrency conflict {StreamId} ..."). See docs/observability.md.
        void SavedQuery(string id, string name, string query) =>
            new Amazon.CDK.AWS.Logs.CfnQueryDefinition(this, id, new Amazon.CDK.AWS.Logs.CfnQueryDefinitionProps
            {
                Name = name,
                LogGroupNames = new[] { commandLogGroup.LogGroupName, queryLogGroup.LogGroupName },
                QueryString = query
            });

        SavedQuery("QueryAllErrors", "NoteTaker/All errors", string.Join("\n",
            "fields @timestamp, level, xray_trace_id, command_type, stream_id, message, @message",
            "| filter level in [\"Error\", \"Warning\"] or @message like /(?i)exception|error|fail/",
            "| sort @timestamp desc",
            "| limit 100"));

        SavedQuery("QueryByTraceId", "NoteTaker/By trace ID", string.Join("\n",
            "fields @timestamp, level, command_type, stream_id, message",
            // Replace the placeholder with the trace id — the Root=1-... value from the
            // x-amzn-trace-id response header (it appears in logs as xray_trace_id).
            "| filter xray_trace_id = \"REPLACE_WITH_XRAY_TRACE_ID\"",
            "| sort @timestamp asc"));

        SavedQuery("QuerySlowestRequests", "NoteTaker/Slowest requests", string.Join("\n",
            // The Lambda REPORT line carries @duration; for per-command/subsegment
            // latency use X-Ray (ReadEvents/AppendEvents subsegments) instead.
            "filter @type = \"REPORT\"",
            "| sort @duration desc",
            "| limit 20",
            "| fields @timestamp, @duration, @billedDuration, @maxMemoryUsed, @requestId"));

        SavedQuery("QueryConcurrencyConflicts", "NoteTaker/Concurrency conflicts", string.Join("\n",
            "fields @timestamp, stream_id, @message",
            "| filter message like /Concurrency conflict/",
            "| sort @timestamp desc",
            "| limit 100"));
    }

    private DistributionProps BuildDistributionProps(
        NoteTakerStackProps props,
        Amazon.CDK.AWS.Apigatewayv2.HttpApi httpApi,
        Bucket webBucket)
    {
        // Rewrite SPA paths (no file extension in last segment) to /index.html at the edge.
        // Scoped to the default S3 behavior so API 404s pass through to the caller unchanged.
        var spaRoutingFunction = new Amazon.CDK.AWS.CloudFront.Function(this, "SpaRoutingFunction",
            new Amazon.CDK.AWS.CloudFront.FunctionProps
            {
                Code = FunctionCode.FromInline("""
                    function handler(event) {
                        var request = event.request;
                        var uri = request.uri;
                        if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
                            request.uri = '/index.html';
                        }
                        return request;
                    }
                    """),
                Runtime = FunctionRuntime.JS_2_0
            });

        var defaultBehavior = new BehaviorOptions
        {
            Origin = S3BucketOrigin.WithOriginAccessControl(webBucket),
            FunctionAssociations = new[]
            {
                new FunctionAssociation
                {
                    Function = spaRoutingFunction,
                    EventType = FunctionEventType.VIEWER_REQUEST
                }
            }
        };

        // Strip /api prefix before forwarding to API Gateway
        var apiStripFunction = new Amazon.CDK.AWS.CloudFront.Function(this, "ApiStripFunction",
            new Amazon.CDK.AWS.CloudFront.FunctionProps
            {
                Code = FunctionCode.FromInline("""
                    function handler(event) {
                        var request = event.request;
                        var prefix = '/api'; // strip CloudFront behaviour prefix before forwarding
                        request.uri = request.uri.slice(prefix.length) || '/';
                        return request;
                    }
                    """),
                Runtime = FunctionRuntime.JS_2_0
            });

        // API Gateway hostname extracted from its endpoint URL (https://id.execute-api.region.amazonaws.com)
        var apiHostname = Fn.Select(2, Fn.Split("/", httpApi.ApiEndpoint));

        var additionalBehaviors = new Dictionary<string, IBehaviorOptions>
        {
            ["/api/*"] = new BehaviorOptions
            {
                Origin = new HttpOrigin(apiHostname),
                AllowedMethods = AllowedMethods.ALLOW_ALL,
                CachePolicy = CachePolicy.CACHING_DISABLED,
                OriginRequestPolicy = OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                FunctionAssociations = new[]
                {
                    new FunctionAssociation
                    {
                        Function = apiStripFunction,
                        EventType = FunctionEventType.VIEWER_REQUEST
                    }
                }
            }
        };

        if (string.IsNullOrEmpty(props.CertificateArn) || string.IsNullOrEmpty(props.DomainName))
        {
            return new DistributionProps
            {
                DefaultBehavior = defaultBehavior,
                DefaultRootObject = "index.html",
                AdditionalBehaviors = additionalBehaviors
            };
        }

        return new DistributionProps
        {
            DefaultBehavior = defaultBehavior,
            DefaultRootObject = "index.html",
            DomainNames = new[] { props.DomainName },
            Certificate = Certificate.FromCertificateArn(this, "Certificate", props.CertificateArn),
            AdditionalBehaviors = additionalBehaviors
        };
    }

}
