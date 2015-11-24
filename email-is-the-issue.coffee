class Github
  constructor: (personalAccessToken) ->
    @personalAccessToken = personalAccessToken

  post: (url, payload) ->
    fullUrl = "https://api.github.com#{url}"

    username = @personalAccessToken
    password = 'x-oauth-basic'
    auth = "Basic " + Utilities.base64Encode("#{username}:#{password}")

    return JSON.parse UrlFetchApp.fetch fullUrl,
      method: 'post'
      headers: {Authorization: auth}
      payload: JSON.stringify(payload)



class App
  constructor: (user, repo) ->
    @user = user
    @userRepo = "#{user}/#{repo}"
    @props = PropertiesService.getScriptProperties()

  checkOldThreadsForUpdates: (howManyThreads) ->
    lock = LockService.getScriptLock()
    lock.waitLock(5000)

    for thread in GMAIL_LABEL.getThreads(0, howManyThreads)
      @createIssueCommentsFromMessages(thread)

    lock.releaseLock()
    return

  checkNewThreads: (howManyThreads) ->
    lock = LockService.getScriptLock()
    lock.waitLock(5000)

    threads = GmailApp.search("in:inbox -list:email.#{@user}.github.com -label:\"#{GMAIL_LABEL_NAME}\"")
    threads.reverse()
    for thread in threads
      break if howManyThreads <= 0
      howManyThreads -= 1
      @createIssueFromThread(thread)
      @createIssueCommentsFromMessages(thread)

    lock.releaseLock()
    return

  createIssueFromThread: (thread) ->
    threadProps = @getThreadProps(thread)

    issue = GITHUB.post "/repos/#{@userRepo}/issues",
      title: thread.getMessages()[0].getSubject()
      body: "[View thread #{thread.getId()} in Gmail](#{thread.getPermalink()})"
      labels: [ GITHUB_LABEL_NAME ]

    threadProps.githubIssueId = issue.number
    threadProps.convertedMessages = {}
    @setThreadProps(thread, threadProps)

    thread.addLabel(GMAIL_LABEL)
    return

  getThreadProps: (thread) ->
    key = "thread-#{thread.getId()}"
    rawThreadProps = @props.getProperty(key)
    threadProps = if rawThreadProps? then JSON.parse(rawThreadProps) else {}
    threadProps.githubIssueId ?= null
    threadProps.convertedMessages ?= {}
    return threadProps

  setThreadProps: (thread, props) ->
    key = "thread-#{thread.getId()}"
    return @props.setProperty(key, JSON.stringify(props))

  createIssueCommentsFromMessages: (thread) ->
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


GMAIL_LABEL_NAME = "added to GitHub"
GMAIL_LABEL = GmailApp.getUserLabelByName(GMAIL_LABEL_NAME)
GITHUB_LABEL_NAME = "from-email"
GITHUB = new Github('YOUR_API_KEY_HERE')
APP = new App('SplashBerkeley', 'email')

`
function main() {
  APP.checkOldThreadsForUpdates(15);
  APP.checkNewThreads(15);
};

function deleteAllThreadProps() {
  return this.props = PropertiesService.getScriptProperties().deleteAllProperties();
}`
