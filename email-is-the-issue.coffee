log = (msg) ->
  Logger.log "LOG " + msg

warn = (msg) ->
  Logger.log "WARN " + msg


class Github
  emailList: ->
    return "#{Settings.githubRepoName}.#{Settings.githubRepoOrg}.github.com"

  fetch: (url, method, payload) ->
    fullUrl = "https://api.github.com/repos/#{Settings.githubRepoOrg}/#{Settings.githubRepoName}#{url}"

    username = Settings.githubPersonalAccessToken
    password = 'x-oauth-basic'
    auth = "Basic " + Utilities.base64Encode("#{username}:#{password}")

    return JSON.parse UrlFetchApp.fetch fullUrl,
      method: method
      headers: {Authorization: auth}
      payload: if payload? then JSON.stringify(payload) else undefined

  post: (url, payload) ->
    @fetch(url, 'post', payload)

  get: (url) ->
    @fetch(url, 'get')


class ThreadProxy
  @fromRaw: (rawThread, propsStorage) ->
    thread = new ThreadProxy()
    thread._raw = rawThread
    thread._propsStorage = propsStorage
    thread._seenBodyRegexps = []
    return thread

  @fromId: (threadId, propsStorage) ->
    thread = new ThreadProxy()
    thread._selectorId = threadId
    thread._propsStorage = propsStorage
    thread._seenBodyRegexps = []
    return thread

  selectorId: -> @_selectorId

  raw: -> @_raw ?= GmailApp.getThreadById(@selectorId())

  messages: -> @_messages ?= (new MessageProxy(@, rawMessage) for rawMessage in @raw().getMessages())

  firstMessage: -> @messages()[0]

  lastMessage: -> @messages()[@messages().length - 1]

  ### This one saves us a few API calls lol ###
  lastMessageId: -> @_lastMessageId ?= @raw().getId()

  firstMessageSubject: -> @_firstMessageSubject ?= @raw().getFirstMessageSubject()

  permalink: -> @_permalink ?= @raw().getPermalink()

  ###
  An older version of this script used GmailThread.getId(), which did not return
  a persistent ID -- it returned the ID of the last message, not the first.
  @firstMessage().id() would be a more reliable way to get the ID. But because
  we have messages saved under the old key, we should try try getting props
  under both before concluding that the props don't exit for that thread.

  https://developers.google.com/apps-script/reference/gmail/gmail-thread#getid
  ###
  propsKey: ->
    return @_propsKey if @_propsKey?

    if @selectorId()?
      @_propsKey = "thread-#{@selectorId()}"
      @_rawProps = @_propsStorage.getProperty(@_propsKey)
      return @_propsKey

    @_propsKey = "thread-#{@firstMessage().id()}"
    @_rawProps = @_propsStorage.getProperty(@_propsKey)
    return @_propsKey if @_rawProps?
    
    @_propsKey = "thread-#{@lastMessage().id()}"
    @_rawProps = @_propsStorage.getProperty(@_propsKey)
    return @_propsKey if @_rawProps?

    return @_propsKey = "thread-#{@firstMessage().id()}"

  rawProps: ->
    @propsKey()
    return @_rawProps

  props: ->
    return @_props if @_props?

    props = if @rawProps()? then JSON.parse @rawProps() else {}

    # Set default props
    props.githubIssueId ?= null
    props.convertedMessages ?= {}
    props.lastSeenClosedAt ?= null
    return @_props = props

  saveProps: ->
    @_propsStorage.setProperty(@propsKey(), JSON.stringify(@props()))
    return

  didConvertMessage: (message) ->
    return message.id() of @props().convertedMessages


class MessageProxy
  constructor: (threadProxy, rawMessage) ->
    @_thread = threadProxy
    @_raw = rawMessage

  thread: -> @_thread

  raw: -> @_raw

  id: -> @_id ?= @raw().getId()

  didConvert: ->
    @thread().didConvertMessage(@)

  body: ->
    return @_body if @_body?
    body = @raw().getBody()

    # Try to avoid avoid representation variations
    body = body.replace(/\n/g, '')
    body = body.replace(/\s+/g, ' ')
    body = body.replace(/(<br\s*(\s+[\w-]+(="[^"]*")?)*)(>)/g, '$1 /$4')
    body = body.replace(/(<hr\s*(\s+[\w-]+(="[^"]*")?)*)(>)/g, '$1 /$4')

    # The following is deprecated; also, it adds extra things.
    # body = Xml.parse(body, true).html.body.toXmlString()
    # The following doesn't work because of self-closing tags.
    # body = XmlService.getRawFormat().format(XmlService.parse(body))

    return @_body = body

  ###
  Remember this for cutting off parts of future messages Note: This feature
  requires that this method be called for messages quoted messages before being
  called for the messages that quote them. The easiest way to do this is to go
  through all messages in time order, which is exactly what we do.
  ###
  addToQuoteDb: ->
    quoteRegex = (literal) -> literal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    bodyRegexp = new RegExp(

      # Apple Mail adds this; remove if possible
      '(' + quoteRegex('<br /><div>') + ')?' +

      # The first snippet of the quoted part
      quoteRegex(@body().substring(0, 1000)) +

      # Hopefully nothing important comes afterwards
      '.*'
    )
    @thread()._seenBodyRegexps.unshift bodyRegexp

  markdown: ->
    return @_markdown if @_markdown?

    body = @body()

    # Cut off quoted text
    for seenBodyRegexp in @thread()._seenBodyRegexps
      body = body.replace(seenBodyRegexp, '<div style="padding:5 0"><font size="1" color="#888888">[Quoted text hidden]</font></div>')

    formatList = (pre, list) -> if list.length > 0 then "**#{pre}:** #{list}\n".replace(/</g, '\\<') else ""
    formatElse = (pre, list) -> "**#{pre}:** #{list}\n".replace(/</g, '\\<')

    @_markdown = (
      formatElse('From', @raw().getFrom()) +
      formatElse('To', @raw().getTo()) +
      formatList('Cc', @raw().getCc()) +
      formatList('Bcc', @raw().getBcc()) +
      formatElse('Date', @raw().getDate()) +
      "\n---\n" +
      "**#{@raw().getSubject()}**" +
      "\n\n" +
      "#{body}"
    )


class GmailLastMessageMarker
  constructor: (app, propsStorage) ->
    @_app = app
    @_propsStorage = propsStorage
    @_key = 'last-message'
    @_position = @_propsStorage.getProperty(@key())

  key: -> @_key

  position: -> @_position

  currentPosition: -> @_currentPosition ?= @_app.lastThread().lastMessageId()

  isBehind: -> @position() != @currentPosition()

  update: -> @_propsStorage.setProperty(@key(), @currentPosition())


class App
  constructor: ->
    @props = PropertiesService.getScriptProperties()

  gmailLabel: -> @_gmailLabel ?= GmailApp.getUserLabelByName(Settings.gmailLabelName)


  ###
  Getting different kinds of threads
  ###

  proxify: (rawThreads) -> (new ThreadProxy.fromRaw(rawThread, @props) for rawThread in rawThreads)

  lastThread: -> @_lastThread ?= @proxify(GmailApp.search("*", 0, 1))[0]

  labeledThreads: (howManyThreads) -> @proxify @gmailLabel().getThreads(0, howManyThreads)

  inboxUnlabeledThreads: (howManyThreads) ->
    searchQuery = "in:inbox -list:#{GITHUB.emailList()} -label:\"#{Settings.gmailLabelName}\""
    return @proxify GmailApp.search(searchQuery).slice(-howManyThreads).reverse()


  ###
  Checking if any new messages have arrived since last check
  ###

  lastMessageMarker: -> @_lastMessageMarker ?= new GmailLastMessageMarker(@, @props)


  ###
  Locks
  ###

  lock: -> @_lock ?= LockService.getScriptLock()

  grabLock: ->
    @lock().waitLock(10)
    return

  releaseLock: ->
    @lock().releaseLock()
    return


  ###
  Main Tasks
  ###

  checkLabeledThreadsForNewMesssages: (howManyThreads) ->
    @createIssueCommentsFromThread(thread) for thread in @labeledThreads(howManyThreads)
    return

  checkInboxForNewThreads: (howManyThreads) ->
    for thread in @inboxUnlabeledThreads(howManyThreads)
      @createIssueFromThread(thread)
      @createIssueCommentsFromThread(thread)

  checkClosedIssuesForArchiving: (howManyIssues) ->
    url = "/issues?sort=updated&state=closed&labels=#{Settings.githubLabelName}"
    for issue in GITHUB.get(url).slice(0, howManyIssues)
      threadId = issue.body.match(/View thread ([0-9a-f]+) in Gmail/)?[1]
      if not threadId?
        warn "Can't find thread id for issue #{issue.number}"
        continue

      thread = ThreadProxy.fromId(threadId, @props)
      if not thread.props().githubIssueId == issue.number
        warn "Issue #{issue.number} references thread #{threadId}"
        warn "but #{threadId}'s props indicates that its issue number is (#{thread.props().githubIssueId})"
        continue

      if thread.props().lastSeenClosedAt == issue.closed_at
        continue

      log "LOG Archiving thread #{threadId} because issue #{issue.number} was closed"
      if not thread.raw()?
        warn "can't find thread id #{threadId}"
        continue
      thread.raw().moveToArchive()
      log "LOG done"

      thread.props().lastSeenClosedAt = issue.closed_at
      thread.saveProps()

    return

  createIssueFromThread: (thread) ->
    issue = GITHUB.post "/issues",
      title: thread.firstMessageSubject()
      body: "[View thread #{thread.firstMessage().id()} in Gmail](#{thread.permalink()})"
      labels: [ Settings.githubLabelName ]

    thread.props().githubIssueId = issue.number
    thread.props().convertedMessages = {}
    thread.saveProps()

    thread.raw().addLabel(@gmailLabel())
    return

  createIssueCommentsFromThread: (thread) ->
    log JSON.stringify thread.props()

    unless thread.props().githubIssueId?
      warn "#{thread.propsKey()} has \"#{Settings.gmailLabelName}\" Gmail label but no associated GitHub issue"
      return

    for message in thread.messages()
      unless message.didConvert()
        issueComment = GITHUB.post "/issues/#{thread.props().githubIssueId}/comments",
          body: message.markdown()

        thread.props().convertedMessages[message.id()] = issueComment.id
        log JSON.stringify thread.props()
        thread.saveProps()

      message.addToQuoteDb()
    return

  checkAll: ->
    @grabLock()
    @checkClosedIssuesForArchiving(15)
    if @lastMessageMarker().isBehind()
      @checkLabeledThreadsForNewMesssages(15)
      @checkInboxForNewThreads(15)
      @lastMessageMarker().update()
    else
      log "no new messages; last message = #{@lastMessageMarker().currentPosition()}"
    @releaseLock()


APP = new App()
GITHUB = new Github()

`
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
*/`
