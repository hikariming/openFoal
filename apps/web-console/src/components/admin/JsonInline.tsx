export function JsonInline(props: { value: unknown }): JSX.Element {
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        borderRadius: 6,
        background: "#0f1726",
        color: "#d5e3ff",
        fontSize: 12,
        maxHeight: 220,
        overflow: "auto"
      }}
    >
      {JSON.stringify(props.value, null, 2)}
    </pre>
  );
}

