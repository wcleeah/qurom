import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
    type LangfuseAgent,
    type LangfuseChain,
    type LangfuseEvaluator,
    type LangfuseGeneration,
    type LangfuseObservation,
    type LangfuseSpan,
    type LangfuseTool,
    propagateAttributes,
    setLangfuseTracerProvider,
    startActiveObservation,
    startObservation,
} from "@langfuse/tracing";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import type { RuntimeConfig } from "./config";

export type TraceObservation = {
    id: string;
    traceId: string;
    type: "Span" | "Agent" | "Generation" | "Tool" | "Chain" | "Evaluator";
    observation: LangfuseObservation;
};

type ObservationInput = {
    traceId: string;
    parentObservationId?: string;
    name: string;
    type?: TraceObservation["type"];
    input?: unknown;
    metadata?: Record<string, unknown>;
};

type ObservationEnd = {
    output?: unknown;
    metadata?: Record<string, unknown>;
    level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
    statusMessage?: string;
    model?: string;
};

export type TelemetryRun = {
    readonly enabled: boolean;
    readonly warning?: string;
    traceId?: string;
    rootObservation?: TraceObservation;
    runWithRootObservation: <T>(fn: () => Promise<T>) => Promise<T>;
    startObservation: (
        input: ObservationInput,
    ) => Promise<TraceObservation | undefined>;
    endObservation: (
        observation: TraceObservation | undefined,
        input?: ObservationEnd,
    ) => Promise<void>;
    updateTrace: (input: {
        output?: unknown;
        metadata?: Record<string, unknown>;
        tags?: string[];
    }) => Promise<void>;
    shutdown: () => Promise<void>;
};

function traceNameForInput(input: {
    inputMode: "topic" | "document";
    topic?: string;
    documentPath?: string;
}) {
    if (input.inputMode === "topic")
        return `research topic: ${input.topic ?? ""}`;
    return `research document: ${input.documentPath ?? ""}`;
}

function langfuseEnabled(config: RuntimeConfig) {
    return Boolean(
        config.env.LANGFUSE_PUBLIC_KEY &&
            config.env.LANGFUSE_SECRET_KEY &&
            config.env.LANGFUSE_BASE_URL,
    );
}

function disabledTelemetry(warning?: string): TelemetryRun {
    return {
        enabled: false,
        warning,
        runWithRootObservation: async (fn) => fn(),
        startObservation: async () => undefined,
        endObservation: async () => {},
        updateTrace: async () => {},
        shutdown: async () => {},
    };
}

function traceMetadata(input: {
    requestId: string;
    inputMode: "topic" | "document";
}) {
    return {
        sessionId: input.requestId,
        inputMode: input.inputMode,
    };
}

type ObservationAttributes = {
    input?: unknown;
    metadata?: Record<string, unknown>;
};

function wrapObservation(
    observation: LangfuseObservation,
    type: TraceObservation["type"],
): TraceObservation {
    return {
        id: observation.id,
        traceId: observation.traceId,
        type,
        observation,
    };
}

function updateTypedObservation(
    observation: LangfuseObservation,
    update: ObservationEnd | undefined,
) {
    const attributes = {
        output: update?.output,
        metadata: update?.metadata,
        level: update?.level,
        statusMessage: update?.statusMessage,
    };

    if (observation.type === "agent") {
        (observation as LangfuseAgent).update(attributes);
        return;
    }

    if (observation.type === "generation") {
        (observation as LangfuseGeneration).update({
            ...attributes,
            model: update?.model,
        });
        return;
    }

    if (observation.type === "tool") {
        (observation as LangfuseTool).update(attributes);
        return;
    }

    if (observation.type === "chain") {
        (observation as LangfuseChain).update(attributes);
        return;
    }

    if (observation.type === "evaluator") {
        (observation as LangfuseEvaluator).update(attributes);
        return;
    }

    (observation as LangfuseSpan).update(attributes);
}

function startTypedObservation(
    parent: LangfuseObservation | undefined,
    name: string,
    type: TraceObservation["type"],
    attributes: ObservationAttributes,
) {
    if (parent) {
        if (type === "Agent")
            return parent.startObservation(name, attributes, {
                asType: "agent",
            });
        if (type === "Generation")
            return parent.startObservation(name, attributes, {
                asType: "generation",
            });
        if (type === "Tool")
            return parent.startObservation(name, attributes, {
                asType: "tool",
            });
        if (type === "Chain")
            return parent.startObservation(name, attributes, {
                asType: "chain",
            });
        if (type === "Evaluator")
            return parent.startObservation(name, attributes, {
                asType: "evaluator",
            });
        return parent.startObservation(name, attributes);
    }

    if (type === "Agent")
        return startObservation(name, attributes, { asType: "agent" });
    if (type === "Generation")
        return startObservation(name, attributes, { asType: "generation" });
    if (type === "Tool")
        return startObservation(name, attributes, { asType: "tool" });
    if (type === "Chain")
        return startObservation(name, attributes, { asType: "chain" });
    if (type === "Evaluator")
        return startObservation(name, attributes, { asType: "evaluator" });
    return startObservation(name, attributes);
}

function defaultObservationType(type: ObservationInput["type"]) {
    return type ?? "Span";
}

export async function createTelemetry(
    config: RuntimeConfig,
    input: {
        requestId: string;
        inputMode: "topic" | "document";
        topic?: string;
        documentPath?: string;
    },
): Promise<TelemetryRun> {
    if (!langfuseEnabled(config)) return disabledTelemetry();

    const provider = new NodeTracerProvider({
        resource: resourceFromAttributes({
            [SEMRESATTRS_SERVICE_NAME]: "research-qurom",
        }),
        spanProcessors: [
            new LangfuseSpanProcessor({
                publicKey: config.env.LANGFUSE_PUBLIC_KEY,
                secretKey: config.env.LANGFUSE_SECRET_KEY,
                baseUrl: config.env.LANGFUSE_BASE_URL,
                environment: "default",
                exportMode: "immediate",
            }),
        ],
    });

    try {
        setLangfuseTracerProvider(provider);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return disabledTelemetry(`disabled Langfuse tracing: ${message}`);
    }

    let active = true;
    const observationsById = new Map<string, LangfuseObservation>();
    let rootObservation: TraceObservation | undefined;
    let rootObservationEnded = false;

    const traceName = traceNameForInput(input);

    return {
        get enabled() {
            return active;
        },
        get traceId() {
            return rootObservation?.traceId;
        },
        get rootObservation() {
            return rootObservation;
        },
        async runWithRootObservation(fn) {
            return startActiveObservation(
                traceName,
                async (observation) => {
                    observation.update({
                        input,
                        metadata: traceMetadata(input),
                    });

                    rootObservation = wrapObservation(observation, "Span");
                    observationsById.set(
                        rootObservation.id,
                        rootObservation.observation,
                    );

                    try {
                        return await propagateAttributes(
                            {
                                sessionId: input.requestId,
                            },
                            fn,
                        );
                    } finally {
                        if (rootObservation && !rootObservationEnded) {
                            rootObservationEnded = true;
                            observationsById.delete(rootObservation.id);
                        }
                    }
                },
                { endOnExit: true },
            );
        },
        async startObservation(next) {
            if (!active) return undefined;

            try {
                const attributes: ObservationAttributes = {
                    input: next.input,
                    metadata: {
                        sessionId: input.requestId,
                        ...next.metadata,
                    },
                };

                const type = defaultObservationType(next.type);
                const parent = next.parentObservationId
                    ? observationsById.get(next.parentObservationId)
                    : undefined;
                const observation = startTypedObservation(
                    parent,
                    next.name,
                    type,
                    attributes,
                );
                const wrapped = wrapObservation(observation, type);
                observationsById.set(wrapped.id, observation);

                return wrapped;
            } catch (error) {
                active = false;
                const message =
                    error instanceof Error ? error.message : String(error);
                console.log(
                    `[telemetry] disabled Langfuse tracing: ${message}`,
                );
                return undefined;
            }
        },
        async endObservation(observation, update) {
            if (!observation || !active) return;

            try {
                updateTypedObservation(observation.observation, update);
                observation.observation.end();
                observationsById.delete(observation.id);
            } catch (error) {
                active = false;
                const message =
                    error instanceof Error ? error.message : String(error);
                console.log(
                    `[telemetry] disabled Langfuse tracing: ${message}`,
                );
            }
        },
        async updateTrace(update) {
            if (!active || !rootObservation || rootObservationEnded) return;

            try {
                const currentRootObservation = rootObservation;
                if (!currentRootObservation) return;

                (currentRootObservation.observation as LangfuseSpan).update({
                    output: update.output,
                    metadata: {
                        ...traceMetadata(input),
                        ...update.metadata,
                    },
                });
            } catch (error) {
                active = false;
                const message =
                    error instanceof Error ? error.message : String(error);
                console.log(
                    `[telemetry] disabled Langfuse tracing: ${message}`,
                );
            }
        },
        async shutdown() {
            if (!active) return;

            try {
                if (rootObservation && !rootObservationEnded) {
                    rootObservation.observation.end();
                    rootObservationEnded = true;
                }
                observationsById.clear();
                await provider.forceFlush();
                await provider.shutdown();
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                console.log(`[telemetry] Langfuse shutdown issue: ${message}`);
            } finally {
                active = false;
                setLangfuseTracerProvider(null);
            }
        },
    };
}
