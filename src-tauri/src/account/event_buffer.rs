#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AccountWakeupKindV1 {
    SessionChanged,
    CapabilitiesChanged,
    OauthAttemptChanged,
    ExternalIntentReady,
    UsageInvalidated,
    ConfigurationTaskChanged,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AccountWakeupEventV1 {
    pub(crate) kind: AccountWakeupKindV1,
    pub(crate) process_generation: u64,
    pub(crate) event_seq: u64,
    pub(crate) account_epoch: Option<u64>,
}

#[derive(Debug)]
pub(crate) struct AccountWakeupBufferV1 {
    process_generation: u64,
    next_event_seq: u64,
    last_accepted_seq: u64,
}

impl AccountWakeupBufferV1 {
    pub(crate) fn new(process_generation: u64) -> Option<Self> {
        (process_generation > 0).then_some(Self {
            process_generation,
            next_event_seq: 1,
            last_accepted_seq: 0,
        })
    }

    pub(crate) fn publish(
        &mut self,
        kind: AccountWakeupKindV1,
        account_epoch: Option<u64>,
    ) -> AccountWakeupEventV1 {
        let event = AccountWakeupEventV1 {
            kind,
            process_generation: self.process_generation,
            event_seq: self.next_event_seq,
            account_epoch,
        };
        self.next_event_seq = self.next_event_seq.saturating_add(1);
        event
    }

    pub(crate) fn accept_wakeup(
        &mut self,
        event: AccountWakeupEventV1,
        expected_account_epoch: Option<u64>,
    ) -> bool {
        if event.process_generation != self.process_generation
            || event.account_epoch != expected_account_epoch
            || event.event_seq == 0
            || event.event_seq <= self.last_accepted_seq
        {
            return false;
        }
        self.last_accepted_seq = event.event_seq;
        true
    }
}
