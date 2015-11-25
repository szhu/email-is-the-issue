// Generated by CoffeeScript 1.10.0
var App, Github;

Github = (function() {
  function Github(personalAccessToken) {
    this.personalAccessToken = personalAccessToken;
  }

  Github.prototype.fetch = function(url, method, payload) {
    var auth, fullUrl, password, username;
    fullUrl = "https://api.github.com" + url;
    username = this.personalAccessToken;
    password = 'x-oauth-basic';
    auth = "Basic " + Utilities.base64Encode(username + ":" + password);
    return JSON.parse(UrlFetchApp.fetch(fullUrl, {
      method: method,
      headers: {
        Authorization: auth
      },
      payload: payload != null ? JSON.stringify(payload) : void 0
    }));
  };

  Github.prototype.post = function(url, payload) {
    return this.fetch(url, 'post', payload);
  };

  Github.prototype.get = function(url) {
    return this.fetch(url, 'get');
  };

  return Github;

})();

App = (function() {
  function App(user, repo) {
    this.user = user;
    this.repo = repo;
    this.userRepo = user + "/" + repo;
    this.props = PropertiesService.getScriptProperties();
  }

  App.prototype.getThreadPropsById = function(threadId) {
    var key, rawThreadProps, threadProps;
    key = "thread-" + threadId;
    rawThreadProps = this.props.getProperty(key);
    threadProps = rawThreadProps != null ? JSON.parse(rawThreadProps) : {};
    if (threadProps.githubIssueId == null) {
      threadProps.githubIssueId = null;
    }
    if (threadProps.convertedMessages == null) {
      threadProps.convertedMessages = {};
    }
    if (threadProps.lastSeenClosedAt == null) {
      threadProps.lastSeenClosedAt = null;
    }
    return threadProps;
  };

  App.prototype.getThreadProps = function(thread) {
    return this.getThreadPropsById(thread.getId());
  };

  App.prototype.setThreadProps = function(thread, props) {
    var key;
    key = "thread-" + (thread.getId());
    return this.props.setProperty(key, JSON.stringify(props));
  };

  App.prototype.getLatestMessageId = function() {
    var latestThread;
    latestThread = GmailApp.search("*", 0, 1)[0];
    return (latestThread.getId()) + "-" + (latestThread.getLastMessageDate());
  };

  App.prototype.gmailHasChanged = function() {
    this.latestMessageId = this.getLatestMessageId();
    return this.latestMessageId === this.props.getProperty('latest-message');
  };

  App.prototype.updateGmailHasChangedMarker = function() {
    if (this.latestMessageId == null) {
      Logger.log("WARN @latestMessageId not set");
      return;
    }
    return this.props.setProperty('latest-message', this.latestMessageId);
  };

  App.prototype.getGmailLabel = function() {
    return this._gmailLabel != null ? this._gmailLabel : this._gmailLabel = GmailApp.getUserLabelByName(GMAIL_LABEL_NAME);
  };

  App.prototype.checkLabeledThreadsForNewMesssages = function(howManyThreads) {
    var firstThread, i, lastMessage, len, lock, messages, ref, thread;
    lock = LockService.getScriptLock();
    lock.waitLock(10);
    firstThread = true;
    ref = this.getGmailLabel().getThreads(0, howManyThreads);
    for (i = 0, len = ref.length; i < len; i++) {
      thread = ref[i];
      if (firstThread) {
        messages = thread.getMessages();
        lastMessage = messages[messages.length - 1];
        if (something === something) {
          lock.releaseLock();
          return;
        }
      }
      firstThread = false;
      this.createIssueCommentsFromThread(thread);
    }
    lock.releaseLock();
  };

  App.prototype.checkInboxForNewThreads = function(howManyThreads) {
    var i, len, lock, thread, threads;
    lock = LockService.getScriptLock();
    lock.waitLock(10);
    threads = GmailApp.search("in:inbox -list:" + this.repo + "." + this.user + ".github.com -label:\"" + GMAIL_LABEL_NAME + "\"");
    threads.reverse();
    for (i = 0, len = threads.length; i < len; i++) {
      thread = threads[i];
      if (howManyThreads <= 0) {
        break;
      }
      howManyThreads -= 1;
      this.createIssueFromThread(thread);
      this.createIssueCommentsFromThread(thread);
    }
    lock.releaseLock();
  };

  App.prototype.checkClosedIssuesForArchiving = function(howManyIssues) {
    var i, issue, len, lock, ref, ref1, thread, threadId, threadProps;
    lock = LockService.getScriptLock();
    lock.waitLock(10);
    ref = GITHUB.get("/repos/" + this.userRepo + "/issues?sort=updated&state=closed&labels=" + GITHUB_LABEL_NAME);
    for (i = 0, len = ref.length; i < len; i++) {
      issue = ref[i];
      if (howManyIssues <= 0) {
        break;
      }
      howManyIssues -= 1;
      threadId = (ref1 = issue.body.match(/View thread ([0-9a-f]+) in Gmail/)) != null ? ref1[1] : void 0;
      if (threadId == null) {
        Logger.log("WARN can't find thread id for issue " + issue.number);
        continue;
      }
      threadProps = this.getThreadPropsById(threadId);
      if (!threadProps.githubIssueId === issue.number) {
        Logger.log("WARN issue " + issue.number + " references thread " + threadId + ", whose recorded issue number is different (" + threadProps.githubIssueId + ")");
        continue;
      }
      if (threadProps.lastSeenClosedAt === issue.closed_at) {
        continue;
      }
      Logger.log("archiving thread " + threadId + " because issue " + issue.number + " was closed");
      thread = GmailApp.getThreadById(threadId);
      if (thread == null) {
        Logger.log("WARN can't find thread id " + threadId);
        continue;
      }
      thread.moveToArchive();
      Logger.log("done");
      threadProps.lastSeenClosedAt = issue.closed_at;
      this.setThreadProps(thread, threadProps);
    }
    lock.releaseLock();
  };

  App.prototype.createIssueFromThread = function(thread) {
    var issue, threadProps;
    threadProps = this.getThreadProps(thread);
    issue = GITHUB.post("/repos/" + this.userRepo + "/issues", {
      title: thread.getFirstMessageSubject(),
      body: "[View thread " + (thread.getId()) + " in Gmail](" + (thread.getPermalink()) + ")",
      labels: [GITHUB_LABEL_NAME]
    });
    threadProps.githubIssueId = issue.number;
    threadProps.convertedMessages = {};
    this.setThreadProps(thread, threadProps);
    thread.addLabel(this.getGmailLabel());
  };

  App.prototype.createIssueCommentsFromThread = function(thread) {
    var formatElse, formatList, formattedMessage, i, issueComment, len, message, messageId, ref, threadProps;
    threadProps = this.getThreadProps(thread);
    Logger.log(threadProps);
    if (threadProps.githubIssueId == null) {
      Logger.log("WARN thread " + (thread.getId()) + " has \"" + GMAIL_LABEL_NAME + "\" Gmail label but no associated GitHub issue");
      return;
    }
    ref = thread.getMessages();
    for (i = 0, len = ref.length; i < len; i++) {
      message = ref[i];
      messageId = message.getId();
      if (messageId in threadProps.convertedMessages) {
        continue;
      }
      formatList = function(pre, list) {
        if (list.length > 0) {
          return ("**" + pre + ":** " + list + "\n").replace(/</g, '\\<');
        } else {
          return "";
        }
      };
      formatElse = function(pre, list) {
        return ("**" + pre + ":** " + list + "\n").replace(/</g, '\\<');
      };
      formattedMessage = formatElse('From', message.getFrom()) + formatElse('To', message.getTo()) + formatList('Cc', message.getCc()) + formatList('Bcc', message.getBcc()) + formatElse('Date', message.getDate()) + "\n---\n" + ("**" + (message.getSubject()) + "**") + "\n\n" + ("" + (message.getBody().replace(/\n/g, '')));
      issueComment = GITHUB.post("/repos/" + this.userRepo + "/issues/" + threadProps.githubIssueId + "/comments", {
        body: formattedMessage
      });
      threadProps.convertedMessages[messageId] = issueComment.id;
      Logger.log(threadProps);
      this.setThreadProps(thread, threadProps);
    }
  };

  App.prototype.checkAll = function() {
    this.checkClosedIssuesForArchiving(15);
    if (this.gmailHasChanged()) {
      this.checkLabeledThreadsForNewMesssages(15);
      this.checkInboxForNewThreads(15);
      return this.updateGmailHasChangedMarker();
    } else {
      return Logger.log("no new messages; latest message = " + this.latestMessageId);
    }
  };

  return App;

})();


function main() { APP.checkAll() }
function noop() { }

function deleteAllThreadProps() {
  return this.props = PropertiesService.getScriptProperties().deleteAllProperties();
}

GMAIL_LABEL_NAME = "added to GitHub";
GITHUB_LABEL_NAME = "from-email";
// APP = new App('YOUR_ORG_OR_USER_HERE', 'YOUR_REPO_NAME_HERE');  // replace with actual values!
// GITHUB = new Github('YOUR_API_KEY_HERE');  // replace with actual values!
;
