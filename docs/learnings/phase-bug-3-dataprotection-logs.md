# Learnings: BUG-3 — Data Protection cold-start log noise

- The "suppress vs persist" choice hinged on whether the app actually uses Data Protection. Confirmed it does not — auth is JWT bearer only (`AddJwtBearer`), with no cookie auth, antiforgery, session, or `IDataProtector` consumers anywhere in `src/`. Suppressing the category at source is therefore correct and is not masking a real misconfiguration. **Action:** verify a subsystem is genuinely unused before suppressing its warnings — Done (verified, decision recorded in the `Builder.cs` comment).
- The fix carries a future precondition: if a Data Protection consumer (cookie auth, antiforgery) is ever added, this filter must be revisited, since it would then hide the very "keys not persisted to storage" warning that would matter. **Action:** precondition captured in the `Builder.cs` comment so the next developer sees it — Done.
- `AddFilter("Microsoft.AspNetCore.DataProtection", LogLevel.Error)` relies on longest-prefix category matching, so it covers the child loggers that emit the three warnings (`XmlKeyManager`, `EphemeralXmlRepository`, `KeyManagement.*`) while leaving the broader `Microsoft.AspNetCore` Warning rule intact for everything else. A control test asserts a non-DP category still warns, proving the filter is scoped. **Action:** none — Documented.

## Applied status

| Learning | Status |
|---|---|
| 1. Verify a subsystem is unused before suppressing its warnings | Applied — confirmed bearer-only auth; decision in `Builder.cs` |
| 2. Record the revisit-if-DP-is-adopted precondition | Applied — `Builder.cs` comment |
| 3. Prefix-matched filter is scoped; control test guards it | Documented — `DataProtectionLoggingTests` |
