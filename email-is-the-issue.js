// Generated by CoffeeScript 1.10.0
var APP, App, GITHUB, Github, GmailLastMessageMarker, MessageProxy, ThreadProxy, log, warn;

log = function(msg) {
  return Logger.log("LOG " + msg);
};

warn = function(msg) {
  return Logger.log("WARN " + msg);
};

Github = (function() {
  function Github() {}

  Github.prototype.emailList = function() {
    return Settings.githubRepoName + "." + Settings.githubRepoOrg + ".github.com";
  };

  Github.prototype.fetch = function(url, method, payload) {
    var auth, fullUrl, password, username;
    fullUrl = "https://api.github.com/repos/" + Settings.githubRepoOrg + "/" + Settings.githubRepoName + url;
    username = Settings.githubPersonalAccessToken;
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

ThreadProxy = (function() {
  function ThreadProxy() {}

  ThreadProxy.fromRaw = function(rawThread, propsStorage) {
    var thread;
    thread = new ThreadProxy();
    thread._raw = rawThread;
    thread._propsStorage = propsStorage;
    thread._seenBodyRegexps = [];
    return thread;
  };

  ThreadProxy.fromId = function(threadId, propsStorage) {
    var thread;
    thread = new ThreadProxy();
    thread._selectorId = threadId;
    thread._propsStorage = propsStorage;
    thread._seenBodyRegexps = [];
    return thread;
  };

  ThreadProxy.prototype.selectorId = function() {
    return this._selectorId;
  };

  ThreadProxy.prototype.raw = function() {
    return this._raw != null ? this._raw : this._raw = GmailApp.getThreadById(this.selectorId());
  };

  ThreadProxy.prototype.messages = function() {
    var rawMessage;
    return this._messages != null ? this._messages : this._messages = (function() {
      var i, len, ref, results;
      ref = this.raw().getMessages();
      results = [];
      for (i = 0, len = ref.length; i < len; i++) {
        rawMessage = ref[i];
        results.push(new MessageProxy(this, rawMessage));
      }
      return results;
    }).call(this);
  };

  ThreadProxy.prototype.firstMessage = function() {
    return this.messages()[0];
  };

  ThreadProxy.prototype.lastMessage = function() {
    return this.messages()[this.messages().length - 1];
  };


  /* This one saves us a few API calls lol */

  ThreadProxy.prototype.lastMessageId = function() {
    return this._lastMessageId != null ? this._lastMessageId : this._lastMessageId = this.raw().getId();
  };

  ThreadProxy.prototype.firstMessageSubject = function() {
    return this._firstMessageSubject != null ? this._firstMessageSubject : this._firstMessageSubject = this.raw().getFirstMessageSubject();
  };

  ThreadProxy.prototype.permalink = function() {
    return this._permalink != null ? this._permalink : this._permalink = this.raw().getPermalink();
  };


  /*
  An older version of this script used GmailThread.getId(), which did not return
  a persistent ID -- it returned the ID of the last message, not the first.
  @firstMessage().id() would be a more reliable way to get the ID. But because
  we have messages saved under the old key, we should try try getting props
  under both before concluding that the props don't exit for that thread.
  
  https://developers.google.com/apps-script/reference/gmail/gmail-thread#getid
   */

  ThreadProxy.prototype.propsKey = function() {
    if (this._propsKey != null) {
      return this._propsKey;
    }
    if (this.selectorId() != null) {
      this._propsKey = "thread-" + (this.selectorId());
      this._rawProps = this._propsStorage.getProperty(this._propsKey);
      return this._propsKey;
    }
    this._propsKey = "thread-" + (this.firstMessage().id());
    this._rawProps = this._propsStorage.getProperty(this._propsKey);
    if (this._rawProps != null) {
      return this._propsKey;
    }
    this._propsKey = "thread-" + (this.lastMessage().id());
    this._rawProps = this._propsStorage.getProperty(this._propsKey);
    if (this._rawProps != null) {
      return this._propsKey;
    }
    return this._propsKey = "thread-" + (this.firstMessage().id());
  };

  ThreadProxy.prototype.rawProps = function() {
    this.propsKey();
    return this._rawProps;
  };

  ThreadProxy.prototype.props = function() {
    var props;
    if (this._props != null) {
      return this._props;
    }
    props = this.rawProps() != null ? JSON.parse(this.rawProps()) : {};
    if (props.githubIssueId == null) {
      props.githubIssueId = null;
    }
    if (props.convertedMessages == null) {
      props.convertedMessages = {};
    }
    if (props.lastSeenClosedAt == null) {
      props.lastSeenClosedAt = null;
    }
    return this._props = props;
  };

  ThreadProxy.prototype.saveProps = function() {
    this._propsStorage.setProperty(this.propsKey(), JSON.stringify(this.props()));
  };

  ThreadProxy.prototype.didConvertMessage = function(message) {
    return message.id() in this.props().convertedMessages;
  };

  return ThreadProxy;

})();

MessageProxy = (function() {
  function MessageProxy(threadProxy, rawMessage) {
    this._thread = threadProxy;
    this._raw = rawMessage;
  }

  MessageProxy.prototype.thread = function() {
    return this._thread;
  };

  MessageProxy.prototype.raw = function() {
    return this._raw;
  };

  MessageProxy.prototype.id = function() {
    return this._id != null ? this._id : this._id = this.raw().getId();
  };

  MessageProxy.prototype.didConvert = function() {
    return this.thread().didConvertMessage(this);
  };

  MessageProxy.prototype.body = function() {
    var body;
    if (this._body != null) {
      return this._body;
    }
    body = this.raw().getBody();
    body = body.replace(/\n/g, '');
    body = body.replace(/\s+/g, ' ');
    body = body.replace(/(<br\s*(\s+[\w-]+(="[^"]*")?)*)(>)/g, '$1 /$4');
    body = body.replace(/(<hr\s*(\s+[\w-]+(="[^"]*")?)*)(>)/g, '$1 /$4');
    return this._body = body;
  };


  /*
  Remember this for cutting off parts of future messages Note: This feature
  requires that this method be called for messages quoted messages before being
  called for the messages that quote them. The easiest way to do this is to go
  through all messages in time order, which is exactly what we do.
   */

  MessageProxy.prototype.addToQuoteDb = function() {
    var bodyRegexp, quoteRegex;
    quoteRegex = function(literal) {
      return literal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    };
    bodyRegexp = new RegExp('(' + quoteRegex('<br /><div>') + ')?' + quoteRegex(this.body().substring(0, 1000)) + '.*');
    return this.thread()._seenBodyRegexps.unshift(bodyRegexp);
  };

  MessageProxy.prototype.markdown = function() {
    var body, formatElse, formatList, i, len, ref, seenBodyRegexp;
    if (this._markdown != null) {
      return this._markdown;
    }
    body = this.body();
    ref = this.thread()._seenBodyRegexps;
    for (i = 0, len = ref.length; i < len; i++) {
      seenBodyRegexp = ref[i];
      body = body.replace(seenBodyRegexp, '<div style="padding:5 0"><font size="1" color="#888888">[Quoted text hidden]</font></div>');
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
    return this._markdown = formatElse('From', this.raw().getFrom()) + formatElse('To', this.raw().getTo()) + formatList('Cc', this.raw().getCc()) + formatList('Bcc', this.raw().getBcc()) + formatElse('Date', this.raw().getDate()) + "\n---\n" + ("**" + (this.raw().getSubject()) + "**") + "\n\n" + ("" + body);
  };

  return MessageProxy;

})();

GmailLastMessageMarker = (function() {
  function GmailLastMessageMarker(app, propsStorage) {
    this._app = app;
    this._propsStorage = propsStorage;
    this._key = 'last-message';
    this._position = this._propsStorage.getProperty(this.key());
  }

  GmailLastMessageMarker.prototype.key = function() {
    return this._key;
  };

  GmailLastMessageMarker.prototype.position = function() {
    return this._position;
  };

  GmailLastMessageMarker.prototype.currentPosition = function() {
    return this._currentPosition != null ? this._currentPosition : this._currentPosition = this._app.lastThread().lastMessageId();
  };

  GmailLastMessageMarker.prototype.isBehind = function() {
    return this.position() !== this.currentPosition();
  };

  GmailLastMessageMarker.prototype.update = function() {
    return this._propsStorage.setProperty(this.key(), this.currentPosition());
  };

  return GmailLastMessageMarker;

})();

App = (function() {
  function App() {
    this.props = PropertiesService.getScriptProperties();
  }

  App.prototype.gmailLabel = function() {
    return this._gmailLabel != null ? this._gmailLabel : this._gmailLabel = GmailApp.getUserLabelByName(Settings.gmailLabelName);
  };


  /*
  Getting different kinds of threads
   */

  App.prototype.proxify = function(rawThreads) {
    var i, len, rawThread, results;
    results = [];
    for (i = 0, len = rawThreads.length; i < len; i++) {
      rawThread = rawThreads[i];
      results.push(new ThreadProxy.fromRaw(rawThread, this.props));
    }
    return results;
  };

  App.prototype.lastThread = function() {
    return this._lastThread != null ? this._lastThread : this._lastThread = this.proxify(GmailApp.search("*", 0, 1))[0];
  };

  App.prototype.labeledThreads = function(howManyThreads) {
    return this.proxify(this.gmailLabel().getThreads(0, howManyThreads));
  };

  App.prototype.inboxUnlabeledThreads = function(howManyThreads) {
    var searchQuery;
    searchQuery = "in:inbox -list:" + (GITHUB.emailList()) + " -label:\"" + Settings.gmailLabelName + "\"";
    return this.proxify(GmailApp.search(searchQuery).slice(-howManyThreads).reverse());
  };


  /*
  Checking if any new messages have arrived since last check
   */

  App.prototype.lastMessageMarker = function() {
    return this._lastMessageMarker != null ? this._lastMessageMarker : this._lastMessageMarker = new GmailLastMessageMarker(this, this.props);
  };


  /*
  Locks
   */

  App.prototype.lock = function() {
    return this._lock != null ? this._lock : this._lock = LockService.getScriptLock();
  };

  App.prototype.grabLock = function() {
    this.lock().waitLock(10);
  };

  App.prototype.releaseLock = function() {
    this.lock().releaseLock();
  };


  /*
  Main Tasks
   */

  App.prototype.checkLabeledThreadsForNewMesssages = function(howManyThreads) {
    var i, len, ref, thread;
    ref = this.labeledThreads(howManyThreads);
    for (i = 0, len = ref.length; i < len; i++) {
      thread = ref[i];
      this.createIssueCommentsFromThread(thread);
    }
  };

  App.prototype.checkInboxForNewThreads = function(howManyThreads) {
    var i, len, ref, results, thread;
    ref = this.inboxUnlabeledThreads(howManyThreads);
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      thread = ref[i];
      this.createIssueFromThread(thread);
      results.push(this.createIssueCommentsFromThread(thread));
    }
    return results;
  };

  App.prototype.checkClosedIssuesForArchiving = function(howManyIssues) {
    var i, issue, len, ref, ref1, thread, threadId, url;
    url = "/issues?sort=updated&state=closed&labels=" + Settings.githubLabelName;
    ref = GITHUB.get(url).slice(0, howManyIssues);
    for (i = 0, len = ref.length; i < len; i++) {
      issue = ref[i];
      threadId = (ref1 = issue.body.match(/View thread ([0-9a-f]+) in Gmail/)) != null ? ref1[1] : void 0;
      if (threadId == null) {
        warn("Can't find thread id for issue " + issue.number);
        continue;
      }
      thread = ThreadProxy.fromId(threadId, this.props);
      if (!thread.props().githubIssueId === issue.number) {
        warn("Issue " + issue.number + " references thread " + threadId);
        warn("but " + threadId + "'s props indicates that its issue number is (" + (thread.props().githubIssueId) + ")");
        continue;
      }
      if (thread.props().lastSeenClosedAt === issue.closed_at) {
        continue;
      }
      log("LOG Archiving thread " + threadId + " because issue " + issue.number + " was closed");
      if (thread.raw() == null) {
        warn("can't find thread id " + threadId);
        continue;
      }
      thread.raw().moveToArchive();
      log("LOG done");
      thread.props().lastSeenClosedAt = issue.closed_at;
      thread.saveProps();
    }
  };

  App.prototype.createIssueFromThread = function(thread) {
    var issue;
    issue = GITHUB.post("/issues", {
      title: thread.firstMessageSubject(),
      body: "[View thread " + (thread.firstMessage().id()) + " in Gmail](" + (thread.permalink()) + ")",
      labels: [Settings.githubLabelName]
    });
    thread.props().githubIssueId = issue.number;
    thread.props().convertedMessages = {};
    thread.saveProps();
    thread.raw().addLabel(this.gmailLabel());
  };

  App.prototype.createIssueCommentsFromThread = function(thread) {
    var i, issueComment, len, message, ref;
    log(JSON.stringify(thread.props()));
    if (thread.props().githubIssueId == null) {
      warn((thread.propsKey()) + " has \"" + Settings.gmailLabelName + "\" Gmail label but no associated GitHub issue");
      return;
    }
    ref = thread.messages();
    for (i = 0, len = ref.length; i < len; i++) {
      message = ref[i];
      if (!message.didConvert()) {
        issueComment = GITHUB.post("/issues/" + (thread.props().githubIssueId) + "/comments", {
          body: message.markdown()
        });
        thread.props().convertedMessages[message.id()] = issueComment.id;
        log(JSON.stringify(thread.props()));
        thread.saveProps();
      }
      message.addToQuoteDb();
    }
  };

  App.prototype.checkAll = function() {
    this.grabLock();
    this.checkClosedIssuesForArchiving(15);
    if (this.lastMessageMarker().isBehind()) {
      this.checkLabeledThreadsForNewMesssages(15);
      this.checkInboxForNewThreads(15);
      this.lastMessageMarker().update();
    } else {
      log("no new messages; last message = " + (this.lastMessageMarker().currentPosition()));
    }
    return this.releaseLock();
  };

  return App;

})();

APP = new App();

GITHUB = new Github();


function main() { APP.checkAll() }
function noop() { }

function clearLatestThreadProp() {
  PropertiesService.getScriptProperties().setProperty('last-message', '');
}
function deleteAllThreadProps() {
  // This is a destructive action -- uncomment below to enable
  // PropertiesService.getScriptProperties().deleteAllProperties();
}

/*
Settings = {
  gmailLabelName: "added to GitHub",
  githubLabelName: "from-email",

  githubPersonalAccessToken: "YOUR_API_KEY_HERE",

  githubRepoOrg: "YOUR_ORG_OR_USER_HERE",
  githubRepoName: "YOUR_REPO_NAME_HERE",
}
*/;
