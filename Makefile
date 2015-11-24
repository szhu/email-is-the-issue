PHONY += default
default: email-is-the-issue.js

%.js: %.coffee
	coffee --bare --compile $<

.PHONY: $(PHONY)
