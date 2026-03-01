import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from '@/pages/login/page'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantStore } from '@/stores/tenant-store'

const mockNavigate = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/components/shared/language-switch', () => ({
  LanguageSwitch: () => <div>language-switch</div>,
}))

vi.mock('@douyinfe/semi-ui', () => {
  const FormContext = createContext<{
    values: Record<string, string>
    setValues: Dispatch<SetStateAction<Record<string, string>>>
  } | null>(null)

  const Form = ({
    initValues,
    onSubmit,
    children,
  }: {
    initValues: Record<string, string>
    onSubmit: (values: Record<string, string>) => void | Promise<void>
    children: ReactNode
  }) => {
    const [values, setValues] = useState<Record<string, string>>(initValues)

    return (
      <FormContext.Provider value={{ values, setValues }}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void onSubmit(values)
          }}
        >
          {children}
        </form>
      </FormContext.Provider>
    )
  }

  const FormInput = ({
    field,
    label,
    mode,
  }: {
    field: string
    label: string
    mode?: string
  }) => {
    const ctx = useContext(FormContext)
    if (!ctx) {
      return null
    }

    return (
      <label>
        {label}
        <input
          aria-label={label}
          type={mode === 'password' ? 'password' : 'text'}
          value={ctx.values[field] ?? ''}
          onChange={(event) => {
            const value = event.target.value
            ctx.setValues((prev) => ({ ...prev, [field]: value }))
          }}
        />
      </label>
    )
  }

  const FormSelect = ({
    field,
    label,
    optionList,
  }: {
    field: string
    label: string
    optionList: Array<{ value: string; label: string }>
  }) => {
    const ctx = useContext(FormContext)
    if (!ctx) {
      return null
    }

    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={ctx.values[field] ?? ''}
          onChange={(event) => {
            const value = event.target.value
            ctx.setValues((prev) => ({ ...prev, [field]: value }))
          }}
        >
          {optionList.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  Form.Input = FormInput
  Form.Select = FormSelect

  return {
    Button: ({ children, htmlType }: { children: ReactNode; htmlType?: string }) => (
      <button type={htmlType === 'submit' ? 'submit' : 'button'}>{children}</button>
    ),
    Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Typography: {
      Title: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
      Paragraph: ({ children }: { children: ReactNode }) => <p>{children}</p>,
      Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    },
    Form,
  }
})

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()

    useTenantStore.setState({
      tenants: [{ id: 'tenant_seed_main', name: 'Seed Tenant', region: 'local' }],
      currentTenantId: 'tenant_seed_main',
      setCurrentTenant: useTenantStore.getState().setCurrentTenant,
    })

    useAuthStore.setState({
      isAuthenticated: false,
      session: null,
      login: useAuthStore.getState().login,
      logout: useAuthStore.getState().logout,
    })
  })

  it('submits login and redirects by role', async () => {
    const loginMock = vi.fn().mockResolvedValue({
      accountId: 'acc_admin',
      name: 'Admin',
      email: 'admin@example.com',
      tenantId: 'tenant_seed_main',
      role: 'admin',
      accessToken: 'token',
    })

    useAuthStore.setState({
      ...useAuthStore.getState(),
      login: loginMock,
    })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('login.password'), {
      target: { value: 'AdminPass123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'login.submit' }))

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({
        email: 'admin@openfoal.dev',
        password: 'AdminPass123!',
        tenantId: 'tenant_seed_main',
      })
    })

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('shows error when submit fails', async () => {
    const loginMock = vi.fn().mockRejectedValue(new Error('failed'))

    useAuthStore.setState({
      ...useAuthStore.getState(),
      login: loginMock,
    })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('login.password'), {
      target: { value: 'WrongPass' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'login.submit' }))

    expect(await screen.findByText('login.loginFailed')).toBeInTheDocument()
  })
})
