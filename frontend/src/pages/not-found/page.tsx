import { Button, Empty } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'

export default function NotFoundPage() {
  const { t } = useTranslation()
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
        title={t('notFound.title')}
        description={t('notFound.description')}
        imageStyle={{ width: 220, height: 220 }}
      >
        <Button type="primary" onClick={() => navigate(routePaths.dashboard)}>
          {t('notFound.backToConsole')}
        </Button>
      </Empty>
    </div>
  )
}
