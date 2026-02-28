import { Space, Typography } from "@douyinfe/semi-ui";
import type { ReactNode } from "react";

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="page-header">
      <div>
        <Typography.Title heading={4} style={{ margin: 0 }}>
          {props.title}
        </Typography.Title>
        {props.subtitle ? (
          <Typography.Text type="tertiary" size="small">
            {props.subtitle}
          </Typography.Text>
        ) : null}
      </div>
      {props.actions ? <Space>{props.actions}</Space> : null}
    </div>
  );
}
