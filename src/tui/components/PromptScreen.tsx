import {
    useKeyboard,
    useRenderer,
    useTerminalDimensions,
} from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { RuntimeConfig } from "../../config";
import type { InputRequest } from "../../schema";
import { openInEditor } from "../editor";
import { TMUX_TOP_INSET, centeredColumnWidth } from "../layout";
import { theme } from "../theme";

export type PromptMode = "topic" | "document";

export interface PromptScreenProps {
    config: RuntimeConfig;
    onSubmit: (request: InputRequest) => void;
    initialMode?: PromptMode;
    initialTopic?: string;
    initialDocument?: { path: string; content: string };
    initialHint?: string;
}

const PromptHint = ({ mode }: { mode: PromptMode }) => (
    <text
        fg={theme.textMuted}
        selectionBg={theme.selectionBg}
        selectionFg={theme.selectionFg}
    >
        Tab: switch modes | Enter: run | q: Quit
        {mode === "topic" ? "" : " | e: open editor"}
    </text>
);

const PromptDescription = ({ mode }: { mode: PromptMode }) => (
    <text
        fg={theme.textMuted}
        selectionBg={theme.selectionBg}
        selectionFg={theme.selectionFg}
    >
        {mode === "topic"
            ? "Ask a research question or paste a topic."
            : "Open $EDITOR, save the document, then run the quorum on that draft."}
    </text>
);

const ModeChip = ({ active, label }: { active: boolean; label: string }) => (
    <box
        border
        borderStyle="single"
        borderColor={active ? theme.borderActive : theme.borderSubtle}
        backgroundColor={active ? theme.backgroundPanel : theme.background}
        paddingLeft={1}
        paddingRight={1}
    >
        <text fg={active ? theme.text : theme.textMuted}>{label}</text>
    </box>
);

export const PromptScreen = ({
    config,
    onSubmit,
    initialMode = "topic",
    initialTopic = "",
    initialDocument,
    initialHint = "",
}: PromptScreenProps) => {
    const { width, height } = useTerminalDimensions();
    const renderer = useRenderer();
    const [mode, setMode] = useState<PromptMode>(initialMode);
    const [topic, setTopic] = useState(initialTopic);
    const [doc, setDoc] = useState<
        { path: string; content: string } | undefined
    >(initialDocument);
    const [hint, setHint] = useState<string>(initialHint);
    const [busy, setBusy] = useState(false);
    const requestId = useMemo(crypto.randomUUID, []);
    const columnWidth = centeredColumnWidth(width, 84, 68);
    const topBias = height >= 34 ? 2 : 1;

    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);

    useEffect(() => {
        setTopic(initialTopic);
    }, [initialTopic]);

    useEffect(() => {
        setDoc(initialDocument);
    }, [initialDocument]);

    useEffect(() => {
        setHint(initialHint);
    }, [initialHint]);

    const submitTopic = () => {
        const trimmed = topic.trim();
        if (trimmed.length === 0) {
            setHint("type a topic to run");
            return;
        }
        onSubmit({ inputMode: "topic", topic: trimmed });
    };

    const handleEditDoc = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const result = await openInEditor({
                requestId: doc ? undefined : requestId,
                path: doc?.path,
                renderer,
                artifactRoot: config.quorumConfig.artifactDir,
            });
            if (result.ok) {
                setDoc({ path: result.path, content: result.content });
                setHint("");
            } else if (result.reason === "empty") {
                setHint("(empty — nothing saved)");
            } else if (result.reason === "cancelled") {
                setHint("(cancelled)");
            } else {
                setHint(`(editor exit ${result.code ?? "?"})`);
            }
        } finally {
            setBusy(false);
        }
    };

    const submitDoc = () => {
        if (!doc || doc.content.trim().length === 0) {
            setHint("compose a document first (press e)");
            return;
        }
        onSubmit({
            inputMode: "document",
            documentPath: doc.path,
            documentText: doc.content,
        });
    };

    useKeyboard((key) => {
        if (key.name === "tab") {
            setMode((current) => (current === "topic" ? "document" : "topic"));
            setHint("");
            return;
        }
        if (mode !== "document") return;

        if (key.name === "e") {
            void handleEditDoc();
            return
        } 
        if (key.name === "return") {
            submitDoc();
            return
        } 
        if (key.name === "escape") {
            setMode("topic");
            setHint("");
        }
    });

    return (
        <box
            flexDirection="column"
            flexGrow={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={theme.background}
        >
            {TMUX_TOP_INSET > 0 ? (
                <box height={TMUX_TOP_INSET} flexShrink={0} />
            ) : null}
            <box flexGrow={1} minHeight={0} />
            {topBias > 0 ? <box height={topBias} flexShrink={0} /> : null}
            <box alignItems="center" flexShrink={0}>
                <box width={columnWidth} flexDirection="column" gap={1}>
                    <box flexDirection="column">
                        <text fg={theme.accent}>research-qurom</text>
                        <text fg={theme.textMuted}>
                            Run a topic or draft a source document, then hand it
                            to the quorum.
                        </text>
                    </box>

                    <box flexDirection="row" gap={1}>
                        <ModeChip active={mode === "topic"} label="topic" />
                        <ModeChip
                            active={mode === "document"}
                            label="compose document"
                        />
                    </box>

                    <box
                        border
                        borderStyle="double"
                        borderColor={theme.borderActive}
                        backgroundColor={theme.backgroundPanel}
                        padding={1}
                        flexDirection="column"
                        gap={1}
                    >
                        <PromptDescription mode={mode} />
                        {mode === "topic" ? (
                            <box
                                border
                                borderStyle="single"
                                borderColor={theme.borderSubtle}
                                backgroundColor={theme.backgroundElement}
                                width="100%"
                                paddingLeft={1}
                                paddingRight={1}
                            >
                                <input
                                    placeholder="e.g. Why is 1+1 2?"
                                    focused
                                    width="100%"
                                    onInput={setTopic}
                                    onSubmit={submitTopic}
                                />
                            </box>
                        ) : (
                            <box
                                border
                                borderStyle="single"
                                borderColor={theme.borderSubtle}
                                backgroundColor={theme.backgroundElement}
                                width="100%"
                                paddingLeft={1}
                                paddingRight={1}
                            >
                                {doc ? (
                                    <text wrapMode="word">
                                        {`${doc.path} | ${doc.content.length} chars`}
                                    </text>
                                ) : (
                                    <text fg={theme.textMuted}>
                                        (no document loaded yet)
                                    </text>
                                )}
                            </box>
                        )}
                    </box>

                    <PromptHint mode={mode} />
                    {hint ? <text fg={theme.warning}>{hint}</text> : null}
                </box>
            </box>
            <box flexGrow={1} minHeight={0} />
        </box>
    );
};
