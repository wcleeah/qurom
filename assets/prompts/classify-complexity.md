Classify this research topic into the most appropriate complexity tier.

Topic: "{topic}"{inputContext}

Tiers:
- "definitional": A term, concept, or simple question. Answerable with an explanation and 1-2 authoritative sources. No deep analysis needed. Example: "What is gRPC?" "What does `docker build` do?"
- "tutorial": A how-to, mechanism walkthrough, or comparison. Needs step-by-step explanation and moderate source depth. Example: "How does Kafka consumer group rebalancing work?"
- "analysis": Deep technical analysis. Needs source-code evidence, multiple perspectives, or performance characteristics. Example: "Explain Linux CFS bandwidth control from kernel source"
- "synthesis": Cross-domain integration. Connects multiple systems or traces requests across boundaries. Example: "How does a Kubernetes pod get an IP address end-to-end?"

If unsure, prefer "analysis" (the safe default).
Return JSON: { "tier": "<tier>", "confidence": <0-1> }
