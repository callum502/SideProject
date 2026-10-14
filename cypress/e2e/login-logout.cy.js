describe('Email login and logout', () => {
  it('logs in through the form, keeps the session on reload, and logs out', () => {
    cy.visit('/#login');
    cy.contains('h1', 'Welcome back').should('be.visible');

    cy.task('loginCredentials', null, { log: false }).then(({ email, password }) => {
      cy.get('input[name="email"]').type(email, { log: false, parseSpecialCharSequences: false });
      cy.get('input[name="password"]').type(password, { log: false, parseSpecialCharSequences: false });
    });
    cy.get('form button[type="submit"]').contains('Log in').click();
    cy.location('hash', { timeout: 20000 }).should('eq', '#explore');
    cy.get('button[aria-label^="Account menu for "]', { timeout: 20000 }).should('be.visible');
    cy.getCookie('sideproj_session', { log: false }).should('exist');

    cy.reload();
    cy.get('button[aria-label^="Account menu for "]', { timeout: 20000 }).should('be.visible').click();
    cy.contains('#user-menu-options button', 'Log Out').click();

    cy.location('hash', { timeout: 20000 }).should('eq', '#login');
    cy.contains('h1', 'Welcome back').should('be.visible');
    cy.get('button[aria-label^="Account menu for "]').should('not.exist');
    cy.getCookie('sideproj_session', { log: false }).should('be.null');
    cy.request('/api/session').its('body.user').should('be.null');
    cy.reload();
    cy.contains('h1', 'Welcome back').should('be.visible');
    cy.get('button[aria-label^="Account menu for "]').should('not.exist');
  });
});
