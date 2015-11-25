class Github
  constructor: (personalAccessToken) ->
    @personalAccessToken = personalAccessToken

  fetch: (url, method, payload) ->
    fullUrl = "https://api.github.com#{url}"

    username = @personalAccessToken
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


class App
  constructor: (user, repo) ->
    @user = user
    @repo = repo
    @userRepo = "#{user}/#{repo}"
    @props = PropertiesService.getScriptProperties()

  getThreadPropsById: (threadId) ->
    key = "thread-#{threadId}"
    rawThreadProps = @props.getProperty(key)
    threadProps = if rawThreadProps? then JSON.parse(rawThreadProps) else {}
    threadProps.githubIssueId ?= null
    threadProps.convertedMessages ?= {}
    threadProps.lastSeenClosedAt ?= null
    return threadProps

  getThreadProps: (thread) ->
    @getThreadPropsById(thread.getId())

  setThreadProps: (thread, props) ->
    key = "thread-#{thread.getId()}"
    return @props.setProperty(key, JSON.stringify(props))

  getLatestMessageId: ->
    latestThread = GmailApp.search("*", 0, 1)[0]
    return "#{latestThread.getId()}-#{latestThread.getLastMessageDate()}"

  gmailHasChanged: ->
    @latestMessageId = @getLatestMessageId()
    return @latestMessageId == @props.getProperty('latest-message')

  updateGmailHasChangedMarker: ->
    unless @latestMessageId?
      Logger.log "WARN @latestMessageId not set"
      return
    @props.setProperty('latest-message', @latestMessageId)

  getGmailLabel: ->
    @_gmailLabel ?= GmailApp.getUserLabelByName(GMAIL_LABEL_NAME)

  checkLabeledThreadsForNewMesssages: (howManyThreads) ->
    lock = LockService.getScriptLock()
    lock.waitLock(10)

    firstThread = true

    for thread in @getGmailLabel().getThreads(0, howManyThreads)
      if firstThread
        messages = thread.getMessages()
        lastMessage = messages[messages.length - 1]

        if something == something
          lock.releaseLock()
          return

      firstThread = false

      @createIssueCommentsFromThread(thread)

    lock.releaseLock()
    return

  checkInboxForNewThreads: (howManyThreads) ->
    lock = LockService.getScriptLock()
    lock.waitLock(10)

    threads = GmailApp.search("in:inbox -list:#{@repo}.#{@user}.github.com -label:\"#{GMAIL_LABEL_NAME}\"")
    threads.reverse()
    for thread in threads
      break if howManyThreads <= 0
      howManyThreads -= 1
      @createIssueFromThread(thread)
      @createIssueCommentsFromThread(thread)

    lock.releaseLock()
    return

  checkClosedIssuesForArchiving: (howManyIssues) ->
    lock = LockService.getScriptLock()
    lock.waitLock(10)

    for issue in GITHUB.get "/repos/#{@userRepo}/issues?sort=updated&state=closed&labels=#{GITHUB_LABEL_NAME}"
      break if howManyIssues <= 0
      howManyIssues -= 1

      threadId = issue.body.match(/View thread ([0-9a-f]+) in Gmail/)?[1]
      if not threadId?
        Logger.log("WARN can't find thread id for issue #{issue.number}")
        continue

      threadProps = @getThreadPropsById(threadId)
      if not threadProps.githubIssueId == issue.number
        Logger.log("WARN issue #{issue.number} references thread #{threadId}, whose recorded issue number is different (#{threadProps.githubIssueId})")
        continue

      if threadProps.lastSeenClosedAt == issue.closed_at
        continue

      Logger.log("archiving thread #{threadId} because issue #{issue.number} was closed")
      thread = GmailApp.getThreadById(threadId)
      if not thread?
        Logger.log("WARN can't find thread id #{threadId}")
        continue
      thread.moveToArchive()
      Logger.log("done")

      threadProps.lastSeenClosedAt = issue.closed_at
      @setThreadProps(thread, threadProps)

    lock.releaseLock()
    return

  createIssueFromThread: (thread) ->
    threadProps = @getThreadProps(thread)

    issue = GITHUB.post "/repos/#{@userRepo}/issues",
      title: thread.getFirstMessageSubject()
      body: "[View thread #{thread.getId()} in Gmail](#{thread.getPermalink()})"
      labels: [ GITHUB_LABEL_NAME ]

    threadProps.githubIssueId = issue.number
    threadProps.convertedMessages = {}
    @setThreadProps(thread, threadProps)

    thread.addLabel(@getGmailLabel())
    return

  createIssueCommentsFromThread: (thread) ->
    threadProps = @getThreadProps(thread)
    Logger.log(threadProps)

    unless threadProps.githubIssueId?
      Logger.log("WARN thread #{thread.getId()} has \"#{GMAIL_LABEL_NAME}\" Gmail label but no associated GitHub issue")
      return

    for message in thread.getMessages()
      messageId = message.getId()
      continue if messageId of threadProps.convertedMessages

      formatList = (pre, list) -> if list.length > 0 then "**#{pre}:** #{list}\n".replace(/</g, '\\<') else ""
      formatElse = (pre, list) -> "**#{pre}:** #{list}\n".replace(/</g, '\\<')

      formattedMessage = (
        formatElse('From', message.getFrom()) +
        formatElse('To', message.getTo()) +
        formatList('Cc', message.getCc()) +
        formatList('Bcc', message.getBcc()) +
        formatElse('Date', message.getDate()) +
        "\n---\n" +
        "**#{message.getSubject()}**" +
        "\n\n" +
        "#{message.getBody().replace(/\n/g, '')}"
      )

      issueComment = GITHUB.post "/repos/#{@userRepo}/issues/#{threadProps.githubIssueId}/comments",
        body: formattedMessage

      threadProps.convertedMessages[messageId] = issueComment.id
      Logger.log(threadProps)
      @setThreadProps(thread, threadProps)
    return

  checkAll: ->
    @checkClosedIssuesForArchiving(15)
    if @gmailHasChanged()
      @checkLabeledThreadsForNewMesssages(15)
      @checkInboxForNewThreads(15)
      @updateGmailHasChangedMarker()
    else
      Logger.log "no new messages; latest message = #{@latestMessageId}"

`
function main() { APP.checkAll() }
function noop() { }

function deleteAllThreadProps() {
  return this.props = PropertiesService.getScriptProperties().deleteAllProperties();
}

GMAIL_LABEL_NAME = "added to GitHub";
GITHUB_LABEL_NAME = "from-email";
// APP = new App('YOUR_ORG_OR_USER_HERE', 'YOUR_REPO_NAME_HERE');  // replace with actual values!
// GITHUB = new Github('YOUR_API_KEY_HERE');  // replace with actual values!
`
