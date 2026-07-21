export const MOBILE_LOGIN_ROLES = Object.freeze(['user', 'advisor']);

const normalizedRole = (role) => String(role || '').trim().toLowerCase();

export const mobileLoginRoleError = ({ actualRole, expectedRole }) => {
  const actual = normalizedRole(actualRole);
  const expected = normalizedRole(expectedRole);

  if (!MOBILE_LOGIN_ROLES.includes(expected)) {
    return 'expectedRole must be either user or advisor';
  }
  if (actual === expected) return null;

  if (actual === 'advisor') {
    return 'This is an advisor account. Please use Log in as advisor.';
  }
  if (actual === 'user') {
    return 'This is a client account. Please use Log in as Client.';
  }
  if (['admin', 'sub_admin', 'superadmin', 'super_admin'].includes(actual)) {
    return 'Administrator accounts cannot sign in to the mobile app. Please use the admin portal.';
  }
  return 'This account type is not supported by the mobile app.';
};
