PHONY += default
default: email-is-the-issue.js

PHONY += copy
copy: email-is-the-issue.js
	@which pbcopy >/dev/null || echo "Sorry, this command requires the Mac-only pbcopy comamnd. You'll have to copy $< manually."
	cat email-is-the-issue.js | pbcopy

%.js: %.coffee
	coffee --bare --compile $<

.PHONY: $(PHONY)
