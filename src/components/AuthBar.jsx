import { useAuth } from '../hooks/useAuth'

export default function AuthBar() {
  const { user, loading, signInWithGoogle, signOut } = useAuth()

  if (loading) {
    return (
      <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--dim)', marginLeft: '8px' }}>
        ...
      </span>
    )
  }

  const btnStyle = {
    padding: '3px 10px',
    fontSize: '11px',
    background: '#1a2a3a',
    border: '1px solid #334',
    color: '#8af',
    borderRadius: '3px',
    cursor: 'pointer',
    fontFamily: 'var(--mono)',
    marginLeft: '8px'
  }

  if (!user) {
    return (
      <button onClick={signInWithGoogle} style={btnStyle} title="Googleでログイン">
        SIGN IN
      </button>
    )
  }

  const label = user.email?.split('@')[0] ?? 'USER'
  return (
    <>
      <span style={{
        fontFamily: 'var(--mono)',
        fontSize: '11px',
        color: 'var(--accent2)',
        marginLeft: '8px',
        maxWidth: '110px',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }} title={user.email}>
        {label}
      </span>
      <button onClick={signOut} style={btnStyle} title="ログアウト">
        SIGN OUT
      </button>
    </>
  )
}
