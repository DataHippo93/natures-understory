'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ROLE_LABELS, ROLE_ORDER, type UserRole, type UserProfile } from '@/lib/supabase/admin';

const roleColor = (role: UserRole) => {
  switch (role) {
    case 'admin':           return { bg: 'rgba(196,146,58,0.15)',  text: '#c4923a',  border: 'rgba(196,146,58,0.3)' };
    case 'gm':              return { bg: 'rgba(122,170,98,0.15)',  text: '#7aaa62',  border: 'rgba(122,170,98,0.3)' };
    case 'agm':             return { bg: 'rgba(122,170,98,0.1)',   text: '#9ab884',  border: 'rgba(122,170,98,0.2)' };
    case 'store_associate': return { bg: 'rgba(232,213,184,0.06)', text: '#a8956e',  border: 'rgba(232,213,184,0.15)' };
    case 'kitchen':         return { bg: 'rgba(176,96,96,0.12)',   text: '#b06060',  border: 'rgba(176,96,96,0.25)' };
  }
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('store_associate');
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteResult(null);

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, full_name: inviteName }),
    });

    const data = await res.json();
    if (res.ok) {
      setInviteResult({ type: 'success', msg: `Invitation sent to ${inviteEmail}` });
      setInviteEmail('');
      setInviteName('');
      setInviteRole('store_associate');
      fetchUsers();
    } else {
      setInviteResult({ type: 'error', msg: data.error ?? 'Failed to send invitation' });
    }
    setInviting(false);
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setUpdatingId(userId);
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    await fetchUsers();
    setUpdatingId(null);
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email}? This cannot be undone.`)) return;
    await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    await fetchUsers();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-wider" style={{ fontFamily: 'var(--font-josefin)', color: 'var(--gold)' }}>
          User Management
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: 'var(--sage)' }}>
          Invite team members and manage access roles
        </p>
      </div>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Team Member</CardTitle>
          <CardDescription>They&apos;ll receive an email to set their password and access the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="space-y-4">
            {inviteResult && (
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{
                  background: inviteResult.type === 'success' ? 'rgba(122,170,98,0.12)' : 'rgba(176,96,96,0.12)',
                  border: `1px solid ${inviteResult.type === 'success' ? 'rgba(122,170,98,0.3)' : 'rgba(176,96,96,0.3)'}`,
                  color: inviteResult.type === 'success' ? '#7aaa62' : '#b06060',
                }}
              >
                {inviteResult.msg}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>
                  Email *
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  placeholder="team@naturesstore.com"
                  className="w-full rounded-md px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--forest-mid)')}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full rounded-md px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--forest-mid)')}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--sage)', fontFamily: 'var(--font-josefin)' }}>
                  Role *
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full rounded-md px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--forest-darkest)', border: '1px solid var(--forest-mid)', color: 'var(--cream)' }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--gold)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--forest-mid)')}
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={inviting}
              className="rounded-md px-5 py-2 text-sm font-bold uppercase tracking-widest transition-opacity disabled:opacity-50"
              style={{ background: 'var(--gold)', color: 'var(--forest-darkest)', fontFamily: 'var(--font-josefin)' }}
            >
              {inviting ? 'Sending…' : 'Send Invitation'}
            </button>
          </form>
        </CardContent>
      </Card>

      {/* User list */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>{users.length} {users.length === 1 ? 'member' : 'members'}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--forest-mid)' }}>
                  {['Member', 'Role', 'Joined', 'Actions'].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest ${i === 3 ? 'text-right' : 'text-left'}`} style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const rc = roleColor(u.role);
                  return (
                    <tr
                      key={u.id}
                      style={{ borderBottom: i < users.length - 1 ? '1px solid var(--forest-mid)' : 'none' }}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium" style={{ color: 'var(--cream)' }}>{u.full_name || '—'}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={updatingId === u.id}
                          onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                          className="rounded px-2 py-1 text-xs font-bold outline-none cursor-pointer"
                          style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}
                        >
                          {ROLE_ORDER.map((r) => (
                            <option key={r} value={r} style={{ background: 'var(--forest)', color: 'var(--cream)' }}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemove(u.id, u.email)}
                          className="text-xs transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#fc8181')}
                          onMouseLeave={(e) => ((e.target as HTMLElement).style.color = 'var(--text-muted)')}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
