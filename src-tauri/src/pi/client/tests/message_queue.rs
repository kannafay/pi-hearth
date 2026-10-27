use super::*;
use std::io::Read;

fn request_body(socket: &mut std::net::TcpStream) -> Option<Value> {
    socket
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    let mut request = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let length = socket.read(&mut buffer).unwrap();
        if length == 0 && request.is_empty() {
            return None;
        }
        assert!(length > 0);
        request.extend_from_slice(&buffer[..length]);
        if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
            let header = String::from_utf8_lossy(&request[..end]);
            let length = header
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|value| value.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            if request.len() >= end + 4 + length {
                return Some(serde_json::from_slice(&request[end + 4..end + 4 + length]).unwrap());
            }
        }
    }
}

async fn until_event(
    received: &mut mpsc::UnboundedReceiver<Value>,
    accept: impl Fn(&Value) -> bool,
) -> Vec<Value> {
    timeout(Duration::from_secs(15), async {
        let mut events = Vec::new();
        while let Some(event) = received.recv().await {
            let done = accept(&event);
            events.push(event);
            if done {
                return events;
            }
        }
        panic!("runtime subscription closed before the expected event");
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn native_queue_continues_in_order_in_the_background_and_stop_clears_pending_messages() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let (advance, phase) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for index in 1..=4 {
            let (mut socket, request) = loop {
                let (mut socket, _) = listener.accept().unwrap();
                // HTTP dispatchers can close a speculative connection without
                // sending a request, especially under parallel load.
                if let Some(request) = request_body(&mut socket) {
                    break (socket, request);
                }
            };
            requests.push(request);
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            let chunk = json!({"id":format!("queue-{index}"), "object":"chat.completion.chunk", "model":"model", "choices":[{"index":0,"delta":{"role":"assistant","content":format!("ANSWER {index}")},"finish_reason":null}]});
            socket
                .write_all(format!("data: {chunk}\n\n").as_bytes())
                .unwrap();
            socket.flush().unwrap();
            phase.recv_timeout(Duration::from_secs(30)).unwrap();
            // The fourth turn is deliberately aborted by the test.
            if index != 4 {
                socket.write_all(b"data: {\"id\":\"queue\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n").unwrap();
            }
        }
        listener.set_nonblocking(true).unwrap();
        assert!(
            listener.accept().is_err(),
            "stopping must not launch another queued turn"
        );
        requests
    });
    let fixture = ResidentFixture::with_endpoint(&endpoint).await;
    let client = fixture
        .manager
        .client(&fixture.initial.instance_id)
        .await
        .unwrap();
    let (events, mut received) = mpsc::unbounded_channel::<Value>();
    client
        .subscribe(Channel::new(move |body| {
            let _ = events.send(body.deserialize().unwrap());
            Ok(())
        }))
        .await
        .unwrap();
    client
        .request(
            json!({"type":"prompt", "message":"FIRST MESSAGE"}),
            Some("first".into()),
        )
        .await
        .unwrap();
    until_event(&mut received, |event| event["data"]["delta"] == "ANSWER 1").await;
    let attachment = Attachment {
        id: "queued-file".into(),
        name: "notes.txt".into(),
        kind: "text".into(),
        mime_type: "text/plain".into(),
        size: 5,
        preview: None,
        source_path: None,
        text: None,
    };
    client.request(json!({"type":"prompt", "message":"<file name=\"notes.txt\">\nQUEUED ATTACHMENT\n</file>\nSECOND MESSAGE", "__hearthMessage":"SECOND MESSAGE", "__hearthAttachments":[attachment]}), Some("second".into())).await.unwrap();
    client
        .request(
            json!({"type":"prompt", "message":"THIRD MESSAGE"}),
            Some("third".into()),
        )
        .await
        .unwrap();
    client
        .request(
            json!({"type":"prompt", "message":"CANCEL THIS"}),
            Some("cancelled".into()),
        )
        .await
        .unwrap();
    let current = client.snapshot().await.unwrap();
    assert_eq!(current.active_run_id.as_deref(), Some("first"));
    assert_eq!(current.messages.last().unwrap().text, "ANSWER 1");
    assert!(
        !current
            .messages
            .iter()
            .any(|message| message.id == "second-user")
    );
    assert_eq!(
        current
            .queued_messages
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
        ["second", "third", "cancelled"]
    );
    assert_eq!(current.queued_messages[0].attachments[0].name, "notes.txt");
    client
        .remove_queued_message("cancelled".into())
        .await
        .unwrap();
    let other = fixture.open(1).await;
    assert_ne!(other.instance_id, client.instance_id);
    assert_eq!(
        fixture
            .manager
            .client(&client.instance_id)
            .await
            .unwrap()
            .process_id,
        client.process_id
    );

    advance.send(()).unwrap();
    let second = until_event(&mut received, |event| event["data"]["delta"] == "ANSWER 2").await;
    let finished_first = second
        .iter()
        .position(|event| event["runId"] == "first" && event["data"]["type"] == "run_finished")
        .unwrap();
    let started_second = second
        .iter()
        .position(|event| event["runId"] == "second" && event["data"]["type"] == "run_started")
        .unwrap();
    assert!(finished_first < started_second);
    let current = client.snapshot().await.unwrap();
    let user = current
        .messages
        .iter()
        .find(|message| message.id == "second-user")
        .unwrap();
    assert_eq!(user.text, "SECOND MESSAGE");
    assert_eq!(user.attachments.as_ref().unwrap()[0].id, "queued-file");
    assert_eq!(current.queued_messages[0].id, "third");
    assert!(client.remove_queued_message("second".into()).await.is_err());
    advance.send(()).unwrap();
    until_event(&mut received, |event| event["data"]["delta"] == "ANSWER 3").await;
    advance.send(()).unwrap();
    until_event(&mut received, |event| {
        event["runId"] == "third" && event["data"]["type"] == "run_finished"
    })
    .await;
    assert!(client.snapshot().await.unwrap().queued_messages.is_empty());

    client
        .request(
            json!({"type":"prompt", "message":"STOP THIS TURN"}),
            Some("fourth".into()),
        )
        .await
        .unwrap();
    until_event(&mut received, |event| event["data"]["delta"] == "ANSWER 4").await;
    client
        .request(
            json!({"type":"prompt", "message":"DO NOT SEND"}),
            Some("never".into()),
        )
        .await
        .unwrap();
    client
        .request(json!({"type":"clear_queue"}), None)
        .await
        .unwrap();
    client.request(json!({"type":"abort"}), None).await.unwrap();
    let stopped = until_event(&mut received, |event| {
        event["runId"] == "fourth" && event["data"]["type"] == "run_finished"
    })
    .await;
    assert_eq!(stopped.last().unwrap()["data"]["status"], "cancelled");
    let current = client.snapshot().await.unwrap();
    assert!(current.queued_messages.is_empty());
    assert!(current.active_run_id.is_none());
    assert!(
        !current
            .messages
            .iter()
            .any(|message| message.text == "DO NOT SEND")
    );
    advance.send(()).unwrap();
    let requests = server.join().unwrap();
    let last_user = |request: &Value| {
        request["messages"]
            .as_array()
            .unwrap()
            .iter()
            .rev()
            .find(|message| message["role"] == "user")
            .unwrap()["content"]
            .to_string()
    };
    assert!(last_user(&requests[0]).contains("FIRST MESSAGE"));
    assert!(last_user(&requests[1]).contains("QUEUED ATTACHMENT"));
    assert!(last_user(&requests[2]).contains("THIRD MESSAGE"));
    assert!(last_user(&requests[3]).contains("STOP THIS TURN"));
    fixture.manager.disconnect().await;
}
