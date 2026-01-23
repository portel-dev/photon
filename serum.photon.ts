/**
 * Serum - Inject clarity into any conversation
 * @description Powerful prompt serums that force specific cognitive behaviors
 * @icon 💉
 */
export default class Serum {
  /**
   * Truth Serum - Forces unfiltered honesty, no hedging or diplomacy
   * @template
   */
  async truth({
    topic,
    domain = 'general',
    audience = 'professional'
  }: {
    /** What you want the truth about */
    topic: string;
    /** Industry/field context: tech, healthcare, finance, education, legal, startup, enterprise, general */
    domain?: string;
    /** Who this is for: beginner, professional, executive, technical */
    audience?: string;
  }): Promise<string> {
    return `💉 TRUTH SERUM INJECTED

You cannot hedge, sugarcoat, or be diplomatic. You must speak with complete honesty.

Domain: ${domain}
Audience: ${audience}
Topic: ${topic}

SERUM EFFECTS:
- State uncomfortable truths that people avoid saying
- Name specific problems, not vague "challenges"
- If something is bad, say it's bad and why
- If you don't know, say "I don't know" - don't speculate
- Give real numbers and examples, not hand-wavy estimates
- Acknowledge trade-offs honestly - nothing is all good
- Skip the "it depends" - take a stance and defend it
- ${domain !== 'general' ? `Apply ${domain}-specific knowledge and standards` : 'Be direct regardless of context'}
- ${audience === 'executive' ? 'Bottom-line it: impact, cost, timeline' : audience === 'technical' ? 'Include technical specifics' : 'Balance depth with accessibility'}

End with: "What I didn't say (but you should know):" and add any uncomfortable implications.`;
  }

  /**
   * Clarity Serum - Cuts through complexity, forces simple explanations
   * @template
   */
  async clarity({
    subject,
    confusionPoints = '',
    domain = 'general'
  }: {
    /** What needs to be clarified */
    subject: string;
    /** Specific points of confusion (optional) */
    confusionPoints?: string;
    /** Industry context for relevant examples */
    domain?: string;
  }): Promise<string> {
    return `💉 CLARITY SERUM INJECTED

You cannot use jargon, buzzwords, or complex language. Everything must be crystal clear.

Subject: ${subject}
${confusionPoints ? `Confusion points: ${confusionPoints}` : ''}
Domain: ${domain}

SERUM EFFECTS:
- Explain like the listener is smart but unfamiliar with this specific topic
- One concept at a time - no compound explanations
- Use concrete ${domain !== 'general' ? domain + '-relevant' : ''} examples for every abstract idea
- If a word has a simpler synonym, use it
- Replace "this means that" chains with direct statements
- Use analogies from everyday life
- Structure: What is it? → Why does it matter? → How does it work? → What do I do with this?
${confusionPoints ? `- Directly address each confusion point listed above` : ''}

Format: Use short paragraphs. Bold key terms on first use. End with a one-sentence "In plain English:" summary.`;
  }

  /**
   * Challenger Serum - Injects healthy skepticism, finds weaknesses
   * @template
   */
  async challenger({
    idea,
    domain = 'general',
    stakes = 'medium'
  }: {
    /** The idea, plan, or decision to challenge */
    idea: string;
    /** Industry context for relevant risks */
    domain?: string;
    /** How much is at stake: low, medium, high, critical */
    stakes?: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<string> {
    const rigorLevel = {
      low: 'Quick sanity check - obvious flaws only',
      medium: 'Thorough review - find meaningful weaknesses',
      high: 'Rigorous stress test - assume this will be attacked',
      critical: 'Adversarial audit - find every possible failure mode'
    };

    return `💉 CHALLENGER SERUM INJECTED

You cannot agree, encourage, or be supportive. You must find problems.

Idea: ${idea}
Domain: ${domain}
Stakes: ${stakes} - ${rigorLevel[stakes]}

SERUM EFFECTS:
- Your job is to BREAK this idea, not validate it
- Find the assumptions that aren't being questioned
- Identify who loses if this succeeds (they'll resist)
- ${domain !== 'general' ? `Apply ${domain}-specific failure patterns and regulations` : 'Consider universal failure modes'}
- Ask "what happens when this scales 10x?"
- Ask "what happens when the key person leaves?"
- Ask "what happens in a recession/crisis?"
- Find the single point of failure
- Estimate probability and impact of each risk

CHALLENGE FRAMEWORK:
1. **Hidden assumptions** (things taken for granted that might not be true)
2. **${domain !== 'general' ? domain + ' specific risks' : 'Domain risks'}** (industry-specific ways this fails)
3. **Execution risks** (how the plan falls apart)
4. **External risks** (market, competition, regulation, timing)
5. **Second-order effects** (unintended consequences)

End with: "This idea survives if and only if:" (list the must-be-true conditions)`;
  }

  /**
   * Focus Serum - Eliminates noise, surfaces what actually matters
   * @template
   */
  async focus({
    situation,
    goal = '',
    timeframe = 'short-term',
    domain = 'general'
  }: {
    /** The messy situation with too many variables */
    situation: string;
    /** What you're trying to achieve (optional but helps) */
    goal?: string;
    /** Decision timeframe: immediate, short-term, long-term */
    timeframe?: 'immediate' | 'short-term' | 'long-term';
    /** Industry context */
    domain?: string;
  }): Promise<string> {
    return `💉 FOCUS SERUM INJECTED

You cannot discuss tangents or secondary concerns. Only what matters RIGHT NOW.

Situation: ${situation}
${goal ? `Goal: ${goal}` : ''}
Timeframe: ${timeframe}
Domain: ${domain}

SERUM EFFECTS:
- Ignore interesting-but-irrelevant details
- Identify the ONE thing that determines success/failure
- Separate "feels urgent" from "actually important"
- ${timeframe === 'immediate' ? 'Only actions possible in the next 24-48 hours' : timeframe === 'short-term' ? 'Focus on this week/month' : 'Ignore tactical details, focus on strategic direction'}
- ${domain !== 'general' ? `What do ${domain} experts focus on in situations like this?` : ''}
- Name the decision that unlocks everything else
- Identify what you're avoiding that you shouldn't be

OUTPUT:
1. **The core issue** (one sentence - everything else is downstream of this)
2. **What to ignore** (things that feel important but aren't)
3. **The one decision** (make this, and other things become clear)
4. **Next action** (specific, concrete, doable ${timeframe === 'immediate' ? 'today' : 'this week'})

End with: "You're overcomplicating this. Just ___."`;
  }

  /**
   * Perspective Serum - Forces you to see from other viewpoints
   * @template
   */
  async perspective({
    situation,
    stakeholders = '',
    domain = 'general'
  }: {
    /** The situation to view from multiple angles */
    situation: string;
    /** Key stakeholders to consider (comma-separated, or leave blank for auto-detect) */
    stakeholders?: string;
    /** Industry context for relevant perspectives */
    domain?: string;
  }): Promise<string> {
    return `💉 PERSPECTIVE SERUM INJECTED

You cannot stay in one viewpoint. You must genuinely inhabit each perspective.

Situation: ${situation}
${stakeholders ? `Key stakeholders: ${stakeholders}` : 'Identify the 4-5 most important stakeholders automatically'}
Domain: ${domain}

SERUM EFFECTS:
- For each stakeholder, don't just describe their view - BECOME them
- What are their incentives? What do they fear? What do they want?
- What information do they have that others don't?
- What would they never say publicly but definitely think?
- ${domain !== 'general' ? `Include ${domain}-specific roles (regulators, industry bodies, etc.)` : ''}
- Find the perspective no one is considering

PERSPECTIVE FORMAT (for each stakeholder):
**[Stakeholder Name]**
- They see: (how this situation appears to them)
- They want: (their ideal outcome)
- They fear: (what keeps them up at night)
- They'll do: (likely actions/reactions)
- Blindspot: (what they're missing)

End with: "The perspective that changes everything:" (the viewpoint that, once understood, reframes the whole situation)`;
  }

  /**
   * Creative Serum - Unlocks non-obvious solutions and connections
   * @template
   */
  async creative({
    challenge,
    constraints = '',
    domain = 'general',
    wildness = 'balanced'
  }: {
    /** The problem or opportunity */
    challenge: string;
    /** Any hard constraints that can't be violated */
    constraints?: string;
    /** Industry context */
    domain?: string;
    /** How unconventional to go: safe, balanced, wild */
    wildness?: 'safe' | 'balanced' | 'wild';
  }): Promise<string> {
    const wildnessGuide = {
      safe: 'Creative but implementable - low risk ideas',
      balanced: 'Mix of practical and bold - some risk acceptable',
      wild: 'Forget conventions - breakthrough thinking, high risk/reward'
    };

    return `💉 CREATIVE SERUM INJECTED

You cannot suggest obvious solutions. You must find unexpected approaches.

Challenge: ${challenge}
${constraints ? `Hard constraints: ${constraints}` : ''}
Domain: ${domain}
Wildness: ${wildness} - ${wildnessGuide[wildness]}

SERUM EFFECTS:
- The first idea that comes to mind is BANNED - dig deeper
- What would a completely different industry do? (${domain !== 'general' ? `How would someone outside ${domain} approach this?` : 'Cross-pollinate from unexpected fields'})
- What's the opposite of the conventional approach?
- What if the constraint was actually an advantage?
- What would this look like if it were easy?
- What would a 10x solution require?
- ${wildness === 'wild' ? 'Ignore "that\'s not how we do things" - question everything' : wildness === 'safe' ? 'Stay within organizational comfort zone' : 'Push boundaries but keep one foot in reality'}

IDEA CATEGORIES:
1. **Inversion** - Do the opposite of conventional wisdom
2. **Combination** - Mash up unrelated concepts
3. **Elimination** - What if we just... didn't do this part?
4. **Exaggeration** - Take one element to an extreme
5. **Transplant** - Steal from ${domain !== 'general' ? 'outside ' + domain : 'a completely different field'}

For each idea: One line description → Why it might work → The leap required

End with: "The idea that scared me to suggest:" (the one that's crazy enough to be brilliant)`;
  }

  /**
   * Action Serum - Converts thinking into specific next steps
   * @template
   */
  async action({
    goal,
    currentState = '',
    blockers = '',
    domain = 'general',
    timeframe = '1 week'
  }: {
    /** What you want to achieve */
    goal: string;
    /** Where you are now (optional) */
    currentState?: string;
    /** What's stopping you (optional) */
    blockers?: string;
    /** Industry context */
    domain?: string;
    /** Timeframe for action: today, 1 week, 1 month, 1 quarter */
    timeframe?: string;
  }): Promise<string> {
    return `💉 ACTION SERUM INJECTED

You cannot be abstract or theoretical. Every output must be a concrete action.

Goal: ${goal}
${currentState ? `Current state: ${currentState}` : ''}
${blockers ? `Blockers: ${blockers}` : ''}
Domain: ${domain}
Timeframe: ${timeframe}

SERUM EFFECTS:
- No "consider" or "think about" - only DO verbs
- Every action must pass the test: "Could I put this on a calendar?"
- Include WHO does WHAT by WHEN
- ${domain !== 'general' ? `Use ${domain}-specific tools, channels, and practices` : ''}
- Sequence matters - what unlocks what?
- Identify the action you're avoiding (there's always one)
${blockers ? `- Directly address each blocker with a specific action` : ''}

ACTION PLAN:

**Today (or first available moment):**
- [ ] [Specific action with verb] - [Time estimate]

**This ${timeframe}:**
- [ ] [Action 1] - Owner: ___ - Due: ___
- [ ] [Action 2] - Owner: ___ - Due: ___
- [ ] [Action 3] - Owner: ___ - Due: ___

**Definition of done:** [How you'll know ${goal} is achieved]

**If nothing else:** The single most important action that moves this forward is: ___`;
  }

  /**
   * Simplify Serum - Reduces complexity ruthlessly
   * @template
   */
  async simplify({
    complex,
    purpose = '',
    domain = 'general'
  }: {
    /** The complex thing (process, system, explanation, plan) */
    complex: string;
    /** What this needs to accomplish */
    purpose?: string;
    /** Industry context */
    domain?: string;
  }): Promise<string> {
    return `💉 SIMPLIFY SERUM INJECTED

You cannot preserve complexity. You must make this radically simpler.

Complex thing: ${complex}
${purpose ? `Purpose: ${purpose}` : ''}
Domain: ${domain}

SERUM EFFECTS:
- If it can be removed without breaking the core purpose, remove it
- If two things can be one thing, merge them
- If it requires explanation, it's too complex
- ${domain !== 'general' ? `Apply ${domain} best practices for simplification` : ''}
- Find the version a smart newcomer could understand in 60 seconds
- "But we've always done it this way" is not a reason to keep something

SIMPLIFICATION PROCESS:

1. **Core purpose** (in one sentence, what must this accomplish?)

2. **Essential elements** (what absolutely cannot be removed?)

3. **Cut list** (everything else - be aggressive)
   - [Element] → Remove because: ___
   - [Element] → Remove because: ___

4. **Simplified version** (rewrite/redesign with only essentials)

5. **Objection handling** ("But what about ___?" → Here's why it's fine)

End with the ULTRA-SIMPLE version: "If you only had 30 seconds, here's what matters: ___"`;
  }

  /**
   * Empathy Serum - Forces genuine understanding of others
   * @template
   */
  async empathy({
    person,
    situation,
    domain = 'general'
  }: {
    /** Who you need to understand (role, relationship, or specific person) */
    person: string;
    /** The context or situation */
    situation: string;
    /** Industry context */
    domain?: string;
  }): Promise<string> {
    return `💉 EMPATHY SERUM INJECTED

You cannot judge or assume. You must genuinely understand this person's experience.

Person: ${person}
Situation: ${situation}
Domain: ${domain}

SERUM EFFECTS:
- Assume they're acting rationally given their information and incentives
- What do they know that you don't?
- What pressures are they under that aren't visible?
- What have they tried before that didn't work?
- ${domain !== 'general' ? `What ${domain}-specific pressures do they face?` : ''}
- What would you feel in their exact position?

EMPATHY MAP:

**Their world:**
- They see: (what's in front of them daily)
- They hear: (what messages/pressure from others)
- They feel: (emotional state, concerns)
- They think: (private thoughts, doubts)

**Their pain:**
- Frustrations: (what annoys them)
- Fears: (what they're afraid of)
- Obstacles: (what's in their way)

**Their gain:**
- Wants: (desires, hopes)
- Needs: (must-haves)
- Success looks like: (their definition of winning)

**The gap:**
What they need that they're not getting: ___
What they're getting that they don't need: ___

End with: "To truly help this person, I would need to ___" (specific action that addresses their real need)`;
  }

  /**
   * Custom Serum - Create your own prompt injection
   * @template
   */
  async custom({
    behavior,
    rules,
    context,
    domain = 'general'
  }: {
    /** What behavior/mindset to inject */
    behavior: string;
    /** Specific rules the AI must follow (comma-separated) */
    rules: string;
    /** The topic/situation to apply this to */
    context: string;
    /** Industry context */
    domain?: string;
  }): Promise<string> {
    const rulesList = rules.split(',').map(r => r.trim()).filter(r => r);

    return `💉 CUSTOM SERUM INJECTED: ${behavior.toUpperCase()}

You are now operating under a custom behavioral injection.

Behavior mode: ${behavior}
Domain: ${domain}
Context: ${context}

SERUM RULES (you MUST follow these):
${rulesList.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}

APPLY THIS BEHAVIOR TO:
${context}

${domain !== 'general' ? `Apply ${domain}-specific knowledge and standards throughout.` : ''}

Begin your response with: "Operating in ${behavior} mode..."`;
  }
}
