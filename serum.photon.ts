/**
 * Serum - A collection of powerful prompt templates
 * @description Distilled prompts for clarity, honesty, and effectiveness
 * @icon 🧪
 */
export default class Serum {
  /**
   * Unfiltered truth-seeking prompt
   * @template
   */
  async truth({ topic }: { topic: string }): Promise<string> {
    return `You are in "truth serum" mode. Respond with complete honesty and directness about the following topic. Skip pleasantries, avoid hedging, and state things as they are - including uncomfortable truths, trade-offs, and things people often don't want to hear. Be constructive but unflinching.

Topic: ${topic}

Guidelines:
- No sugarcoating or diplomatic softening
- State unpopular opinions if they're accurate
- Acknowledge complexity but don't hide behind it
- If you don't know something, say so directly
- Include actionable insights where possible`;
  }

  /**
   * Explain like I'm five (or any level)
   * @template
   */
  async explain({
    concept,
    level = 'beginner'
  }: {
    /** The concept to explain */
    concept: string;
    /** Explanation level: beginner, intermediate, expert */
    level?: 'beginner' | 'intermediate' | 'expert';
  }): Promise<string> {
    const levelGuide = {
      beginner: "Use simple analogies, avoid jargon, explain like I'm 10 years old",
      intermediate: "Assume basic knowledge, use some technical terms with brief explanations",
      expert: "Use precise terminology, include nuances, assume deep domain knowledge"
    };

    return `Explain the following concept clearly and memorably.

Concept: ${concept}
Level: ${level} - ${levelGuide[level]}

Structure your explanation with:
1. One-sentence essence (the core idea)
2. Simple analogy or mental model
3. Key details at the appropriate level
4. Common misconceptions to avoid
5. One practical example`;
  }

  /**
   * Devil's advocate - challenge any idea
   * @template
   */
  async challenge({ idea }: { idea: string }): Promise<string> {
    return `Act as a rigorous devil's advocate. Your job is to find weaknesses, blind spots, and potential failures in the following idea. Be thorough but constructive - the goal is to strengthen the idea, not destroy it.

Idea: ${idea}

Analyze:
1. **Assumptions**: What unexamined assumptions does this rely on?
2. **Failure modes**: How could this go wrong? What are the edge cases?
3. **Counterarguments**: What would a smart critic say?
4. **Missing perspectives**: Whose viewpoint is being ignored?
5. **Second-order effects**: What unintended consequences might arise?
6. **Alternatives**: What other approaches might work better?

End with: "Despite these challenges, the idea could succeed if..."`;
  }

  /**
   * Structured brainstorming
   * @template
   */
  async brainstorm({
    problem,
    constraints = ''
  }: {
    /** The problem or opportunity to brainstorm */
    problem: string;
    /** Any constraints or requirements */
    constraints?: string;
  }): Promise<string> {
    return `Generate diverse, creative solutions for the following problem. Push beyond obvious answers.

Problem: ${problem}
${constraints ? `Constraints: ${constraints}` : ''}

Generate ideas in these categories:
1. **Safe bets** (2-3): Proven approaches that reliably work
2. **Creative twists** (2-3): Unexpected angles on conventional solutions
3. **Moonshots** (2-3): Bold ideas that could be transformative if they work
4. **Combinations** (1-2): Hybrid approaches mixing elements from above

For each idea, include:
- One-line description
- Why it might work
- Biggest risk or challenge

End with your top recommendation and why.`;
  }

  /**
   * Code review with specific focus
   * @template
   */
  async review({
    code,
    focus = 'all'
  }: {
    /** The code to review */
    code: string;
    /** Focus area: security, performance, readability, all */
    focus?: 'security' | 'performance' | 'readability' | 'all';
  }): Promise<string> {
    const focusGuide: Record<string, string> = {
      security: 'Focus on vulnerabilities, injection risks, auth issues, data exposure',
      performance: 'Focus on complexity, memory usage, unnecessary operations, caching opportunities',
      readability: 'Focus on naming, structure, comments, single responsibility',
      all: 'Review security, performance, and readability comprehensively'
    };

    return `Review the following code with a ${focus} focus.

\`\`\`
${code}
\`\`\`

Focus: ${focusGuide[focus]}

Provide:
1. **Critical issues** (must fix): Problems that could cause bugs or security issues
2. **Improvements** (should fix): Changes that would meaningfully improve the code
3. **Suggestions** (nice to have): Minor enhancements and style preferences
4. **What's good**: Acknowledge well-written parts (important for learning)

Use specific line references and show corrected code snippets where helpful.`;
  }

  /**
   * Summarize content at different depths
   * @template
   */
  async summarize({
    content,
    style = 'bullets'
  }: {
    /** The content to summarize */
    content: string;
    /** Summary style */
    style?: 'tldr' | 'bullets' | 'detailed' | 'executive';
  }): Promise<string> {
    const styleGuide: Record<string, string> = {
      tldr: 'One sentence capturing the absolute essence',
      bullets: '5-7 bullet points covering key information',
      detailed: 'Structured summary with sections, preserving important nuances',
      executive: 'Business-focused summary: situation, implications, recommendations'
    };

    return `Summarize the following content.

Content:
${content}

Style: ${style} - ${styleGuide[style]}

${style === 'executive' ? `
Include:
- **Situation**: What is this about?
- **Key findings**: What matters most?
- **Implications**: So what? Why does this matter?
- **Recommendations**: What should be done?
` : ''}`;
  }

  /**
   * Debug helper - systematic problem solving
   * @template
   */
  async debug({
    issue,
    context = ''
  }: {
    /** Description of the issue */
    issue: string;
    /** Additional context: error messages, what you've tried, environment */
    context?: string;
  }): Promise<string> {
    return `Help debug the following issue systematically.

Issue: ${issue}
${context ? `Context: ${context}` : ''}

Approach:
1. **Clarify**: Restate the problem to confirm understanding
2. **Hypothesize**: List 3-5 most likely causes, ranked by probability
3. **Investigate**: For each hypothesis, suggest specific diagnostic steps
4. **Quick wins**: Things to try that often resolve similar issues
5. **If still stuck**: Suggest what additional information would help

Be specific with commands, code snippets, or steps to run.`;
  }

  /**
   * Decision matrix - structured decision making
   * @template
   */
  async decide({
    decision,
    options
  }: {
    /** The decision to make */
    decision: string;
    /** Comma-separated list of options */
    options: string;
  }): Promise<string> {
    return `Help make a well-reasoned decision.

Decision: ${decision}
Options: ${options}

Analysis framework:
1. **Criteria**: What factors matter most for this decision? Weight them (high/medium/low)
2. **Options matrix**: Rate each option against each criterion
3. **Pros/Cons**: Key advantages and disadvantages of each
4. **Risks**: What could go wrong with each choice?
5. **Reversibility**: How easy is it to change course if this doesn't work?
6. **Gut check**: Beyond the analysis, what feels right?

End with a clear recommendation and the key reason why.`;
  }

  /**
   * Reframe - see problems differently
   * @template
   */
  async reframe({ situation }: { situation: string }): Promise<string> {
    return `Reframe the following situation from multiple perspectives to unlock new insights.

Situation: ${situation}

Perspectives:
1. **Invert**: What if the opposite were true? What if this is actually an opportunity?
2. **10x scale**: What would you do if this was 10x bigger/smaller?
3. **Time shift**: How will this matter in 10 days? 10 months? 10 years?
4. **Outsider view**: What would someone with no context notice immediately?
5. **Abundance mindset**: What if resources (time/money/people) weren't the constraint?
6. **First principles**: Strip away assumptions - what's actually true here?

End with: "The most useful reframe is... because..."`;
  }

  /**
   * Teach me - Socratic learning
   * @template
   */
  async teach({
    skill,
    currentLevel = 'beginner'
  }: {
    /** What you want to learn */
    skill: string;
    /** Your current level */
    currentLevel?: 'none' | 'beginner' | 'intermediate' | 'advanced';
  }): Promise<string> {
    return `Teach me ${skill} using the Socratic method - guide me to understanding through questions and discovery rather than just telling me answers.

Current level: ${currentLevel}

Teaching approach:
1. Start with a thought-provoking question to gauge understanding
2. Build on responses with progressively deeper questions
3. When I'm stuck, provide a hint rather than the answer
4. Use concrete examples and analogies
5. Celebrate insights and gently correct misconceptions
6. End each exchange with a question or small challenge

Begin with an opening question that will reveal what I already understand about ${skill}.`;
  }
}
