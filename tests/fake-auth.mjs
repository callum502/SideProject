export function fakeAuth() {
  const users = {
    Admin: { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', name: 'Same name', role: 'admin' },
    Contributor: { id: '00000000-0000-4000-8000-000000000002', email: 'contributor@example.com', name: 'Same name', role: 'contributor' },
    Other: { id: '00000000-0000-4000-8000-000000000003', email: 'other@example.com', name: 'Same name', role: 'contributor' },
  };
  return {
    users,
    async login(values) {
      const user = Object.values(users).find(user => user.email === values.email);
      if (!user || values.password !== 'test-password') throw Object.assign(new Error('Incorrect email or password.'), { status: 401 });
      return { user, expires: Date.now() + 3600000 };
    },
    async resolve(session) { return session.user; },
    async logout() {},
  };
}
