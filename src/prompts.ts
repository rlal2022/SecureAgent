import { encode, encodeChat } from "gpt-tokenizer";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import type { PRFile } from "./constants";
import {
  rawPatchStrategy,
  smarterContextPatchStrategy,
} from "./context/review";
import { GROQ_MODEL, type GroqChatModel } from "./llms/groq";

const ModelsToTokenLimits: Record<GroqChatModel, number> = {
  "mixtral-8x7b-32768": 32768,
  "gemma-7b-it": 32768,
  "llama3-70b-8192": 8192,
  "llama3-8b-8192": 8192,
};

export const REVIEW_DIFF_PROMPT = `You are a PR Review Agent, an AI assistant designed to help developers review pull requests efficiently and effectively. Your primary goal is to provide constructive feedback on code changes, ensuring code quality, maintainability, and adherence to best practices.

Example PR Diff input:
'
## src/file1.py

@@ -12,5 +12,5 @@ def func1():
code line that already existed in the file...
code line that already existed in the file....
-code line that was removed in the PR
+new code line added in the PR
 code line that already existed in the file...
 code line that already existed in the file...

@@ ... @@ def func2():
...


## src/file2.py
...
'

The review should focus on new code added in the PR (lines starting with '+'), and not on code that already existed in the file (lines starting with '-', or without prefix).

ALWAYS FOLLOW THE GUIDELINES WRAPPED IN ** **

**1. Understand the context of the code, summarize the changes and their intended impact on the project**
**2. Evaluate the code for readability, clarity, and simplicity. Suggest improvements where the code can be improved**
**3. Always use best practices for code, including naming conventions, code structure, and design**
**4. Ensure that the code meets functional requirements, highlight any potential issues or edge cases that may not be handled**
**5. Identify any areas where the code could be improved for performance
**6. Look for any potential security invulnerabilities in the code and verify the code through appropriate tests**
**7. Avoid making suggestions that have already been implemented into the PR code**
**8. Don't suggest adding docstring, comments, etc. Your feedback and suggestions should be meaningful**
**9. Make sure the code suggestions that you provide are in the same programming language**

Don't repeat the prompt in the answer, and avoid outputting the 'type' and 'description' fields.

Think through your suggestions and make exceptional improvements.`;

export const XML_PR_REVIEW_PROMPT = `As the PR-Reviewer AI model, you are tasked to analyze git pull requests across any programming language and provide comprehensive and precise code enhancements. Keep your focus on the new code modifications indicated by '+' lines in the PR. Your feedback should hunt for code issues, opportunities for performance enhancement, security improvements, and ways to increase readability. 

Ensure your suggestions are novel and haven't been previously incorporated in the '+' lines of the PR code. Refrain from proposing enhancements that add docstrings, type hints, or comments. Your recommendations should strictly target the '+' lines without suggesting the need for complete context such as the whole repo or codebase.

Your code suggestions should match the programming language in the PR, steer clear of needless repetition or inclusion of 'type' and 'description' fields.

Formulate thoughtful suggestions aimed at strengthening performance, security, and readability, and represent them in an XML format utilizing the tags: <review>, <code>, <suggestion>, <comment>, <type>, <describe>, <filename>. While multiple recommendations can be given, they should all reside within one <review> tag.

Also note, all your code suggestions should follow the valid Markdown syntax for GitHub, identifying the language they're written in, and should be enclosed within backticks (\`\`\`). 

Don't hesitate to add as many constructive suggestions as are relevant to really improve the effectivity of the code.

Example output:
\`\`\`
<review>
  <suggestion>
    <describe>[Objective of the newly incorporated code]</describe>
    <type>[Category of the given suggestion such as performance, security, etc.]</type>
    <comment>[Guidance on enhancing the new code]</comment>
    <code>
    \`\`\`[Programming Language]
    [Equivalent code amendment in the same language]
    \`\`\`
    </code>
    <filename>[name of relevant file]</filename>
  </suggestion>
  <suggestion>
  ...
  </suggestion>
  ...
</review>
\`\`\`

Note: The 'comment' and 'describe' tags should elucidate the advice and why it’s given, while the 'code' tag hosts the recommended code snippet within proper GitHub Markdown syntax. The 'type' defines the suggestion's category such as performance, security, readability, etc.`;

export const PR_SUGGESTION_TEMPLATE = `{COMMENT}
{ISSUE_LINK}

{CODE}
`;

const assignLineNumbers = (diff: string) => {
  const lines = diff.split("\n");
  let newLine = 0;
  const lineNumbers = [];

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // This is a chunk header. Parse the line numbers.
      const match = line.match(/@@ -\d+,\d+ \+(\d+),\d+ @@/);
      newLine = parseInt(match[1]);
      lineNumbers.push(line); // keep chunk headers as is
    } else if (!line.startsWith("-")) {
      // This is a line from the new file.
      lineNumbers.push(`${newLine++}: ${line}`);
    }
  }

  return lineNumbers.join("\n");
};

export const buildSuggestionPrompt = (file: PRFile) => {
  const rawPatch = String.raw`${file.patch}`;
  const patchWithLines = assignLineNumbers(rawPatch);
  return `## ${file.filename}\n\n${patchWithLines}`;
};

export const buildPatchPrompt = (file: PRFile) => {
  if (file.old_contents == null) {
    return rawPatchStrategy(file);
  } else {
    return smarterContextPatchStrategy(file);
  }
};

export const getReviewPrompt = (diff: string): ChatCompletionMessageParam[] => {
  return [
    { role: "system", content: REVIEW_DIFF_PROMPT },
    { role: "user", content: diff },
  ];
};

export const getXMLReviewPrompt = (
  diff: string
): ChatCompletionMessageParam[] => {
  return [
    { role: "system", content: XML_PR_REVIEW_PROMPT },
    { role: "user", content: diff },
  ];
};

export const constructPrompt = (
  files: PRFile[],
  patchBuilder: (file: PRFile) => string,
  convoBuilder: (diff: string) => ChatCompletionMessageParam[]
) => {
  const patches = files.map((file) => patchBuilder(file));
  const diff = patches.join("\n");
  const convo = convoBuilder(diff);
  return convo;
};

export const getTokenLength = (blob: string) => {
  return encode(blob).length;
};

export const isConversationWithinLimit = (
  convo: any[],
  model: GroqChatModel = GROQ_MODEL
) => {
  // We don't have the encoder for our Groq model, so we're using
  // the one for gpt-3.5-turbo as a rough equivalent.
  const convoTokens = encodeChat(convo, "gpt-3.5-turbo").length;
  return convoTokens < ModelsToTokenLimits[model];
};
