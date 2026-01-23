/**
 * Truth Serum - Forces unfiltered honesty, no hedging or diplomacy
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
    /** What you want the unfiltered truth about */
    topic: string;
    /** Industry context for domain-specific honesty */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
    /** Tailor the response depth and style */
    audience?: 'beginner' | 'professional' | 'executive' | 'technical';
  }): Promise<string> {
    const audienceGuide = {
      beginner: 'Use accessible language, explain implications clearly',
      professional: 'Balance depth with accessibility',
      executive: 'Bottom-line it: impact, cost, timeline, risks',
      technical: 'Include technical specifics and implementation details'
    };

    return `💉 TRUTH SERUM INJECTED

You cannot hedge, sugarcoat, or be diplomatic. You must speak with complete honesty.

Topic: ${topic}
Domain: ${domain}
Audience: ${audience} - ${audienceGuide[audience]}

SERUM EFFECTS - You MUST:
- State uncomfortable truths that people avoid saying
- Name specific problems, not vague "challenges"
- If something is bad, say it's bad and why
- If you don't know, say "I don't know" - don't speculate
- Give real numbers and examples, not hand-wavy estimates
- Acknowledge trade-offs honestly - nothing is all good
- Skip the "it depends" - take a stance and defend it
${domain !== 'general' ? `- Apply ${domain}-specific knowledge, standards, and failure patterns` : ''}

End with: "What I didn't say (but you should know):" - add uncomfortable implications.`;
  }

  /**
   * Clarity Serum - Cuts through complexity, forces simple explanations
   * @template
   */
  async clarity({
    subject,
    targetLevel = 'simple',
    domain = 'general'
  }: {
    /** What needs to be clarified or explained */
    subject: string;
    /** How simple should the explanation be */
    targetLevel?: 'eli5' | 'simple' | 'detailed' | 'technical';
    /** Use examples from this industry */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const levelGuide = {
      eli5: 'Explain like I\'m 5 - use toys, candy, playground analogies',
      simple: 'Smart person unfamiliar with this topic - no jargon',
      detailed: 'Include nuances but keep it accessible',
      technical: 'Precise terminology, assume domain knowledge'
    };

    return `💉 CLARITY SERUM INJECTED

You cannot use jargon, buzzwords, or complex language. Everything must be crystal clear.

Subject: ${subject}
Level: ${targetLevel} - ${levelGuide[targetLevel]}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- One concept at a time - no compound explanations
- Use concrete ${domain !== 'general' ? domain + '-relevant ' : ''}examples for every abstract idea
- If a word has a simpler synonym, use it
- Replace "this means that" chains with direct statements
- Use analogies from everyday life

Structure your explanation:
1. **What is it?** (one sentence)
2. **Why does it matter?** (real-world impact)
3. **How does it work?** (simple mechanics)
4. **What do I do with this?** (practical application)

End with: "In plain English:" - one sentence a child could understand.`;
  }

  /**
   * Challenger Serum - Injects healthy skepticism, stress-tests ideas
   * @template
   */
  async challenger({
    idea,
    stakes = 'medium',
    domain = 'general'
  }: {
    /** The idea, plan, or decision to stress-test */
    idea: string;
    /** How rigorous should the challenge be */
    stakes?: 'quick-check' | 'medium' | 'high' | 'critical';
    /** Industry context for relevant risks */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const stakesGuide = {
      'quick-check': 'Quick sanity check - obvious flaws only (2-3 min review)',
      'medium': 'Thorough review - find meaningful weaknesses',
      'high': 'Rigorous stress test - assume this will be attacked',
      'critical': 'Adversarial audit - find every possible failure mode'
    };

    return `💉 CHALLENGER SERUM INJECTED

You cannot agree, encourage, or be supportive. Your job is to BREAK this idea.

Idea: ${idea}
Rigor: ${stakes} - ${stakesGuide[stakes]}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- Find assumptions that aren't being questioned
- Identify who loses if this succeeds (they'll resist)
- Ask "what happens when this scales 10x?"
- Ask "what happens when the key person leaves?"
- Ask "what happens in a downturn/crisis?"
- Find the single point of failure
${domain !== 'general' ? `- Apply ${domain}-specific failure patterns and regulations` : ''}

CHALLENGE FRAMEWORK:
1. **Hidden assumptions** - things taken for granted that might not be true
2. **Execution risks** - how the plan falls apart in practice
3. **External risks** - market, competition, regulation, timing
4. **Second-order effects** - unintended consequences
${domain !== 'general' ? `5. **${domain} specific risks** - industry-specific ways this fails` : ''}

End with: "This survives if and only if:" - list must-be-true conditions.`;
  }

  /**
   * Focus Serum - Eliminates noise, surfaces what actually matters
   * @template
   */
  async focus({
    situation,
    timeframe = 'this-week',
    domain = 'general'
  }: {
    /** The messy situation with too many variables */
    situation: string;
    /** What timeframe are we optimizing for */
    timeframe?: 'today' | 'this-week' | 'this-month' | 'this-quarter' | 'this-year';
    /** Industry context */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const timeframeGuide = {
      'today': 'Only actions possible in the next 24 hours',
      'this-week': 'Focus on this week\'s priorities',
      'this-month': 'Monthly goals and milestones',
      'this-quarter': 'Quarterly objectives, ignore daily noise',
      'this-year': 'Annual strategy, ignore tactical details'
    };

    return `💉 FOCUS SERUM INJECTED

You cannot discuss tangents or secondary concerns. Only what matters RIGHT NOW.

Situation: ${situation}
Timeframe: ${timeframe} - ${timeframeGuide[timeframe]}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- Ignore interesting-but-irrelevant details
- Identify the ONE thing that determines success/failure
- Separate "feels urgent" from "actually important"
- Name the decision that unlocks everything else
- Identify what's being avoided that shouldn't be
${domain !== 'general' ? `- Apply ${domain} prioritization frameworks` : ''}

OUTPUT:
1. **The core issue** - one sentence, everything else is downstream
2. **Ignore these** - things that feel important but aren't
3. **The one decision** - make this, and other things become clear
4. **Next action** - specific, concrete, doable ${timeframe}

End with: "You're overcomplicating this. Just ___."`;
  }

  /**
   * Perspective Serum - Forces genuine multi-stakeholder viewpoint
   * @template
   */
  async perspective({
    situation,
    domain = 'general'
  }: {
    /** The situation to view from multiple angles */
    situation: string;
    /** Industry context for relevant stakeholders */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const domainStakeholders: Record<string, string> = {
      'tech': 'engineers, product managers, users, investors, ops team',
      'healthcare': 'patients, doctors, nurses, administrators, insurers, regulators',
      'finance': 'clients, advisors, compliance, regulators, shareholders',
      'education': 'students, teachers, parents, administrators, policymakers',
      'legal': 'clients, opposing counsel, judges, regulators, public',
      'startup': 'founders, investors, early customers, employees, competitors',
      'enterprise': 'executives, middle management, end users, IT, procurement',
      'marketing': 'customers, brand team, sales, executives, agencies',
      'general': 'primary stakeholders, secondary affected parties, decision makers'
    };

    return `💉 PERSPECTIVE SERUM INJECTED

You cannot stay in one viewpoint. You must genuinely inhabit each perspective.

Situation: ${situation}
Domain: ${domain}
Key stakeholders to consider: ${domainStakeholders[domain]}

SERUM EFFECTS - You MUST:
- For each stakeholder, don't just describe their view - BECOME them
- What are their incentives? What do they fear? What do they want?
- What information do they have that others don't?
- What would they never say publicly but definitely think?
- Find the perspective no one is considering

For each stakeholder:
**[Role]**
- They see: (how this appears to them)
- They want: (their ideal outcome)
- They fear: (what keeps them up at night)
- They'll do: (likely actions/reactions)
- Blindspot: (what they're missing)

End with: "The perspective that changes everything:" - the viewpoint that reframes the whole situation.`;
  }

  /**
   * Creative Serum - Unlocks non-obvious solutions and connections
   * @template
   */
  async creative({
    challenge,
    constraints = 'none',
    wildness = 'balanced',
    domain = 'general'
  }: {
    /** The problem or opportunity to solve creatively */
    challenge: string;
    /** Hard constraints that cannot be violated */
    constraints?: string;
    /** How unconventional should ideas be */
    wildness?: 'safe' | 'balanced' | 'wild' | 'moonshot';
    /** Industry to cross-pollinate from or apply to */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const wildnessGuide = {
      'safe': 'Creative but implementable today - low risk',
      'balanced': 'Mix of practical and bold - some risk acceptable',
      'wild': 'Forget conventions - high risk, high reward',
      'moonshot': '10x thinking - what would change everything?'
    };

    return `💉 CREATIVE SERUM INJECTED

You cannot suggest obvious solutions. You must find unexpected approaches.

Challenge: ${challenge}
Constraints: ${constraints}
Wildness: ${wildness} - ${wildnessGuide[wildness]}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- The first idea that comes to mind is BANNED - dig deeper
- What would a completely different industry do?
- What's the opposite of the conventional approach?
- What if the constraint was actually an advantage?
- What would this look like if it were easy?
${wildness === 'moonshot' ? '- What would a 10x solution require? Ignore "impossible"' : ''}

GENERATE IDEAS IN THESE CATEGORIES:
1. **Inversion** - do the opposite of conventional wisdom
2. **Combination** - mash up unrelated concepts
3. **Elimination** - what if we just... didn't do this part?
4. **Transplant** - steal from ${domain !== 'general' ? 'outside ' + domain : 'a completely different field'}
5. **Exaggeration** - take one element to an extreme

For each: One line → Why it might work → The leap required

End with: "The idea that scared me to suggest:" - crazy enough to be brilliant.`;
  }

  /**
   * Action Serum - Converts thinking into specific next steps
   * @template
   */
  async action({
    goal,
    blockers = 'none',
    timeframe = 'this-week',
    domain = 'general'
  }: {
    /** What you want to achieve */
    goal: string;
    /** What's currently stopping progress */
    blockers?: string;
    /** Timeframe for the action plan */
    timeframe?: 'today' | 'this-week' | 'this-month' | 'this-quarter';
    /** Industry context for relevant tools and practices */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    return `💉 ACTION SERUM INJECTED

You cannot be abstract or theoretical. Every output must be a concrete action.

Goal: ${goal}
Blockers: ${blockers}
Timeframe: ${timeframe}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- No "consider" or "think about" - only DO verbs
- Every action must pass: "Could I put this on a calendar?"
- Include WHO does WHAT by WHEN
- Sequence matters - what unlocks what?
- Identify the action being avoided (there's always one)
${blockers !== 'none' ? `- Directly address each blocker with a specific action` : ''}
${domain !== 'general' ? `- Use ${domain}-specific tools, channels, and practices` : ''}

ACTION PLAN:

**Immediately (next 2 hours):**
- [ ] [Specific action] - [Time estimate]

**${timeframe}:**
- [ ] [Action] - Owner: ___ - Due: ___
- [ ] [Action] - Owner: ___ - Due: ___
- [ ] [Action] - Owner: ___ - Due: ___

**Definition of done:** How you'll know ${goal} is achieved

**If nothing else:** The single most important action is: ___`;
  }

  /**
   * Simplify Serum - Reduces complexity ruthlessly
   * @template
   */
  async simplify({
    complex,
    targetAudience = 'newcomer',
    domain = 'general'
  }: {
    /** The complex thing to simplify (process, system, explanation, plan) */
    complex: string;
    /** Who needs to understand this */
    targetAudience?: 'newcomer' | 'team-member' | 'executive' | 'customer' | 'regulator';
    /** Industry context */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const audienceGuide = {
      'newcomer': 'Someone on day 1 should understand in 60 seconds',
      'team-member': 'Colleagues who need to work with this',
      'executive': 'Decision makers who need the essence only',
      'customer': 'End users who just want it to work',
      'regulator': 'Compliance officers who need to verify'
    };

    return `💉 SIMPLIFY SERUM INJECTED

You cannot preserve complexity. You must make this radically simpler.

Complex thing: ${complex}
Target: ${targetAudience} - ${audienceGuide[targetAudience]}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- If it can be removed without breaking core purpose, remove it
- If two things can be one thing, merge them
- If it requires explanation, it's too complex
- "We've always done it this way" is not a reason to keep something
${domain !== 'general' ? `- Apply ${domain} best practices for simplification` : ''}

SIMPLIFICATION PROCESS:

1. **Core purpose** - one sentence, what must this accomplish?

2. **Essential elements** - what absolutely cannot be removed?

3. **Cut list** (be aggressive):
   - [Element] → Remove because: ___

4. **Simplified version** - rewrite with only essentials

5. **Objection handling** - "But what about ___?" → Here's why it's fine

End with: "30-second version:" - what matters in one breath.`;
  }

  /**
   * Empathy Serum - Forces genuine understanding of others
   * @template
   */
  async empathy({
    person,
    situation,
    relationship = 'professional',
    domain = 'general'
  }: {
    /** Who you need to understand (role or specific person) */
    person: string;
    /** The context or situation */
    situation: string;
    /** Your relationship to this person */
    relationship?: 'professional' | 'customer' | 'report' | 'manager' | 'peer' | 'adversary' | 'personal';
    /** Industry context */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    return `💉 EMPATHY SERUM INJECTED

You cannot judge or assume. You must genuinely understand this person's experience.

Person: ${person}
Situation: ${situation}
Relationship: ${relationship}
Domain: ${domain}

SERUM EFFECTS - You MUST:
- Assume they're acting rationally given their information and incentives
- What do they know that you don't?
- What pressures are they under that aren't visible?
- What have they tried before that didn't work?
- What would you feel in their exact position?
${domain !== 'general' ? `- What ${domain}-specific pressures do they face?` : ''}

EMPATHY MAP:

**Their world:**
- See: (what's in front of them daily)
- Hear: (messages/pressure from others)
- Feel: (emotional state, concerns)
- Think: (private thoughts, doubts)

**Their pain:**
- Frustrations | Fears | Obstacles

**Their gain:**
- Wants | Needs | Success looks like

**The gap:**
- What they need but aren't getting
- What they're getting but don't need

End with: "To truly help this person, I would need to ___"`;
  }

  /**
   * Custom Serum - Create your own behavioral injection
   * @template
   */
  async custom({
    serumName,
    behavior,
    rules,
    applyTo,
    domain = 'general'
  }: {
    /** Name for your custom serum */
    serumName: string;
    /** What behavior/mindset to inject */
    behavior: string;
    /** Specific rules the AI must follow (one per line or comma-separated) */
    rules: string;
    /** The topic/situation to apply this to */
    applyTo: string;
    /** Industry context */
    domain?: 'tech' | 'healthcare' | 'finance' | 'education' | 'legal' | 'startup' | 'enterprise' | 'marketing' | 'general';
  }): Promise<string> {
    const rulesList = rules.split(/[,\n]/).map(r => r.trim()).filter(r => r);

    return `💉 ${serumName.toUpperCase()} SERUM INJECTED

You are now operating under a custom behavioral injection.

Behavior mode: ${behavior}
Domain: ${domain}

SERUM RULES - You MUST follow these:
${rulesList.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}

APPLY TO:
${applyTo}

${domain !== 'general' ? `Apply ${domain}-specific knowledge and standards throughout.` : ''}

Begin with: "Operating in ${serumName} mode..."`;
  }
}
