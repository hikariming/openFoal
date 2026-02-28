import { Button, Empty } from '@douyinfe/semi-ui'
import { useNavigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <Empty
        title="页面不存在"
        description="你访问的地址不存在，返回企业控制台继续操作。"
        imageStyle={{ width: 220, height: 220 }}
      >
        <Button type="primary" onClick={() => navigate(routePaths.dashboard)}>
          回到控制台
        </Button>
      </Empty>
    </div>
  )
}
