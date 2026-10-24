# SideProj

A platform used to share information around outdoor bouldering locations worldwide.

As someone who enjoys bouldering both indoors and outdoors, I have noticed that information on outdoor bouldering locations can be very vague and hard to find. In the past I've found myself sinking hours into creating a Google Doc to collate information on a bouldering location from several vaguely worded sources. I developed this platform for myself and my local community to use as a simpler alternative to existing sites, forums and books.

This platform allows for and encourages uploading images and provides tools to annotate them in place, making it much easier to highlight the holds used for a specific problem. Each location also requires a set of coordinates and a link to the location on Google Maps is automatically generated from these, making it much easier to understand how to travel to the location.

https://github.com/user-attachments/assets/99ae8287-3f0a-49d6-ac0d-032c67f550e1

# Test Dashboard

Throughout the development of SideProj I made careful use of AI tools for modifying UI, CSS, generating SQL queries and implementing new features where appropriate. To catch bugs that slipped through, I backed this up with strong automated testing.

With the rise of AI tools development is getting faster which is making QA become more of a bottleneck. The Test Dashboard addresses this with a clean, usable UI and AI analysis that quickly diagnoses and offers to fix common test failures.

A common reason tests fail is a change to the UI or its selectors. Developers often make quick UI changes with AI and want test results before shipping to production. Existing regression tests covering that UI then fail because they expect the old selectors. To handle this, the dashboard has an AI analysis button on failing tests. It flags tests that broke because of UI changes and proposes a fix for each one. A QA engineer can then update the tests quickly and keep up with AI-assisted development. It ensures that all changes require approval from a QAE so that high quality testing and trust in the test suite can be maintained.

If the AI analysis determines that a test failure is likely to be due to a genuine bug it will draft a report and ask for QAE approval to submit it. This helps speed up the triage process for a QAE and once again helps to combat the increasing speed of AI assisted development. The AI drafted bug reports will automatically contain reproduction steps, expect/actual outcomes along with a run video, logs and the playwright trace.

The video below showcases an example run of a group of tests using the dashboard. It highlights a UI update for one failing test along with a genuine bug for another:

https://github.com/user-attachments/assets/874ddd98-3fb9-4120-add3-b6291f953939
