import { Button, Space } from "@douyinfe/semi-ui";

export type RowAction = {
  key: string;
  text: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export function RowActions(props: { actions: RowAction[] }): JSX.Element {
  return (
    <Space wrap>
      {props.actions.map((action) => (
        <Button key={action.key} size="small" theme="borderless" type={action.danger ? "danger" : "tertiary"} disabled={action.disabled} onClick={action.onClick}>
          {action.text}
        </Button>
      ))}
    </Space>
  );
}

