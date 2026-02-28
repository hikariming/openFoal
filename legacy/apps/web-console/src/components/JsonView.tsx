export function JsonView(props: { value: unknown }): JSX.Element {
  return <pre className="json-view">{JSON.stringify(props.value, null, 2)}</pre>;
}
