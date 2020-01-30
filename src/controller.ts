import { Adapter } from "./adapter"
import { BrowserAdapter } from "./browser_adapter"
import { FormSubmission } from "./form_submission"
import { FormSubmitObserver } from "./form_submit_observer"
import { History } from "./history"
import { LinkClickObserver } from "./link_click_observer"
import { Location, Locatable } from "./location"
import { Navigator, NavigatorDelegate } from "./navigator"
import { PageObserver } from "./page_observer"
import { ScrollObserver } from "./scroll_observer"
import { Action, Position, isAction } from "./types"
import { closest, dispatch } from "./util"
import { View } from "./view"
import { Visit, VisitOptions } from "./visit"

export type TimingData = {}

export class Controller implements NavigatorDelegate {
  static supported = !!(
    window.history.pushState &&
    window.requestAnimationFrame &&
    window.addEventListener
  )

  readonly navigator = new Navigator(this)
  readonly adapter: Adapter = new BrowserAdapter(this)
  readonly history = new History(this)
  readonly view = new View(this)

  readonly pageObserver = new PageObserver(this)
  readonly linkClickObserver = new LinkClickObserver(this)
  readonly formSubmitObserver = new FormSubmitObserver(this)
  readonly scrollObserver = new ScrollObserver(this)

  enabled = true
  progressBarDelay = 500
  started = false

  start() {
    if (Controller.supported && !this.started) {
      this.pageObserver.start()
      this.linkClickObserver.start()
      this.formSubmitObserver.start()
      this.scrollObserver.start()
      this.history.start()
      this.started = true
      this.enabled = true
    }
  }

  disable() {
    this.enabled = false
  }

  stop() {
    if (this.started) {
      this.pageObserver.stop()
      this.linkClickObserver.stop()
      this.formSubmitObserver.stop()
      this.scrollObserver.stop()
      this.history.stop()
      this.started = false
    }
  }

  clearCache() {
    this.view.clearSnapshotCache()
  }

  visit(location: Locatable, options: Partial<VisitOptions> = {}) {
    this.navigator.proposeVisit(Location.wrap(location), options)
  }

  startVisitToLocation(location: Locatable, restorationIdentifier: string, options?: Partial<VisitOptions>) {
    this.navigator.startVisit(Location.wrap(location), restorationIdentifier, options)
  }

  setProgressBarDelay(delay: number) {
    this.progressBarDelay = delay
  }

  get location() {
    return this.history.location
  }

  get restorationIdentifier() {
    return this.history.restorationIdentifier
  }

  // History delegate

  historyPoppedToLocationWithRestorationIdentifier(location: Location, restorationIdentifier: string) {
    if (this.enabled) {
      this.navigator.proposeVisit(location, { action: "restore", historyChanged: true })
    } else {
      this.adapter.pageInvalidated()
    }
  }

  // Scroll observer delegate

  scrollPositionChanged(position: Position) {
    this.history.updateRestorationData({ scrollPosition: position })
  }

  // Link click observer delegate

  willFollowLinkToLocation(link: Element, location: Location) {
    return this.linkIsVisitable(link)
      && this.locationIsVisitable(location)
      && this.applicationAllowsFollowingLinkToLocation(link, location)
  }

  followedLinkToLocation(link: Element, location: Location) {
    const action = this.getActionForLink(link)
    this.visit(location, { action })
  }

  // Navigator delegate

  allowsVisitingLocation(location: Location) {
    return this.applicationAllowsVisitingLocation(location)
  }

  visitProposedToLocation(location: Location, options: Partial<VisitOptions>) {
    this.adapter.visitProposedToLocation(location, options)
  }

  visitStarted(visit: Visit) {
    this.notifyApplicationAfterVisitingLocation(visit.location)
  }

  visitCompleted(visit: Visit) {
    this.notifyApplicationAfterPageLoad(visit.getTimingMetrics())
  }

  formSubmissionStarted(formSubmission: FormSubmission) {
    this.notifyApplicationBeforeStartingFormSubmission(formSubmission)
  }

  formSubmissionFinished(formSubmission: FormSubmission) {
    this.notifyApplicationAfterFinishingFormSubmission(formSubmission)
  }

  // Form submit observer delegate

  willSubmitForm(form: HTMLFormElement) {
    return true
  }

  formSubmitted(form: HTMLFormElement) {
    this.navigator.submitForm(form)
  }

  // Page observer delegate

  pageBecameInteractive() {
    this.view.lastRenderedLocation = this.location
    this.notifyApplicationAfterPageLoad()
  }

  pageLoaded() {

  }

  pageInvalidated() {
    this.adapter.pageInvalidated()
  }

  // View delegate

  viewWillRender(newBody: HTMLBodyElement) {
    this.notifyApplicationBeforeRender(newBody)
  }

  viewRendered() {
    this.view.lastRenderedLocation = this.history.location
    this.notifyApplicationAfterRender()
  }

  viewInvalidated() {
    this.pageObserver.invalidate()
  }

  viewWillCacheSnapshot() {
    this.notifyApplicationBeforeCachingSnapshot()
  }

  // Application events

  applicationAllowsFollowingLinkToLocation(link: Element, location: Location) {
    const event = this.notifyApplicationAfterClickingLinkToLocation(link, location)
    return !event.defaultPrevented
  }

  applicationAllowsVisitingLocation(location: Location) {
    const event = this.notifyApplicationBeforeVisitingLocation(location)
    return !event.defaultPrevented
  }

  notifyApplicationAfterClickingLinkToLocation(link: Element, location: Location) {
    return dispatch("turbolinks:click", { target: link, data: { url: location.absoluteURL }, cancelable: true })
  }

  notifyApplicationBeforeVisitingLocation(location: Location) {
    return dispatch("turbolinks:before-visit", { data: { url: location.absoluteURL }, cancelable: true })
  }

  notifyApplicationAfterVisitingLocation(location: Location) {
    return dispatch("turbolinks:visit", { data: { url: location.absoluteURL } })
  }

  notifyApplicationBeforeCachingSnapshot() {
    return dispatch("turbolinks:before-cache")
  }

  notifyApplicationBeforeRender(newBody: HTMLBodyElement) {
    return dispatch("turbolinks:before-render", { data: { newBody }})
  }

  notifyApplicationAfterRender() {
    return dispatch("turbolinks:render")
  }

  notifyApplicationAfterPageLoad(timing: TimingData = {}) {
    return dispatch("turbolinks:load", { data: { url: this.location.absoluteURL, timing }})
  }

  notifyApplicationBeforeStartingFormSubmission({ formElement, formData }: FormSubmission) {
    return dispatch("turbolinks:submit-start", { target: formElement, data: { formData } })
  }

  notifyApplicationAfterFinishingFormSubmission({ formElement, formData }: FormSubmission) {
    return dispatch("turbolinks:submit-end", { target: formElement, data: { formData }})
  }

  // Private

  getActionForLink(link: Element): Action {
    const action = link.getAttribute("data-turbolinks-action")
    return isAction(action) ? action : "advance"
  }

  linkIsVisitable(link: Element) {
    const container = closest(link, "[data-turbolinks]")
    if (container) {
      return container.getAttribute("data-turbolinks") != "false"
    } else {
      return true
    }
  }

  locationIsVisitable(location: Location) {
    return location.isPrefixedBy(this.view.getRootLocation()) && location.isHTML()
  }
}