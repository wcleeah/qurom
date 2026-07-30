Repair malformed JSON syntax only. Do not change the data, structure, or values — fix unescaped quotes, trailing commas, missing brackets, and similar syntax errors. Do not audit or comment on the content.

The JSON file at `{outputFile}` could not be parsed.
Read that file, fix the JSON syntax, and rewrite the entire file with valid JSON. Respond with `OK` when done.
Escape double-quote characters inside string values with backslash-quote.

Parse error:
{parseError}
