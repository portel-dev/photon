# Why Photon

## MCP is Personal

Here's something the MCP ecosystem got backwards. Everyone is building MCPs for *everyone*. Configuration options for twelve database engines. Auth flows for providers you've never heard of. README files longer than the actual code.

But who are you building this for? Maybe just yourself. Maybe your team of four. Maybe your company. The point is, it's not for the whole internet. And once you accept that, the code gets absurdly simple.

You need a Postgres photon that connects to your database, queries your tables, returns your columns. That's it. Twelve lines. Not twelve hundred. No settings page. No "provider abstraction layer." Just the thing, doing the thing.

And if someone already built something close? Take it. Read it (it's one file, you'll survive). Change the three lines that don't fit your life. Now it's yours. No forks to maintain, no pull requests to negotiate, no waiting for a maintainer who went hiking in 2019 and never came back.

The secret, it turns out, is not building for everyone. It's building for exactly who needs it.

## Solve Once, Run Forever

You need three MCPs to run in sequence. Step one fetches data, step two transforms it, step three stores it. Straightforward, right? You have two options, and neither is great.

Option one: dump all three MCPs into your chat context and hope the AI figures out the order. Every intermediary result, every schema description, every tool listing eats tokens. You're paying rent on data you never wanted in the room.

Option two: let the AI write code to glue them together. And modern LLMs are good at this. Really good. It'll probably nail it on the first try. Which raises an interesting question: if it got it right the first time, why are you asking it to figure it out again? And again tomorrow? And again fifty times next week?

Not every orchestration needs intelligence to think through every time. "Fetch, transform, store" doesn't get more interesting on the second run. The AI already solved it. Throwing that solution away and asking it to re-derive the same answer from scratch is like having your architect redraw your house from memory every time you want to open the front door.

Photon lets you keep the answer. Compose MCPs and photons inside a single photon. The steps are explicit, the order is fixed, the output is predictable. The AI helped you write it once. Now it just runs. No middleman, no tokens, no latency. Which, for a workflow that runs fifty times a day, turns out to matter quite a lot.

## Same Door, Every Key

A photon exposes one interface. AI calls it through MCP. You type a command in the CLI. You open it in Beam and click a button. Three ways in today, more tomorrow. The interface is the constant. How you reach it is your business.

This solves a problem most people don't realize they have. When AI calls a tool, you usually have no idea what it actually sees. With Photon, you can open Beam, look at the same method, run it yourself. No mystery. No "what did the AI just do?" You can see it because you're using the same door.

And here's the thing nobody talks about: half the time, you don't need AI at all. You know exactly what you want. You know the query. You know the parameters. You just need the result. So you call the method yourself, get the answer, and move on. No tokens spent. No round trip. No "I'd be happy to help you with that." Just the data, in your hands, in under a second.

Turns out the best AI tool is one that works perfectly fine without AI.
