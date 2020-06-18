import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios, { AxiosResponse } from "axios";

admin.initializeApp();

export const addCommentToPostTest = functions.firestore.document(`posts_test/{postId}/comments/{commentId}`)
    .onCreate(async (snapshot, context) => {
        const docData = snapshot.data();
        const maxTopicsCount = 3;
        const numTopicsToUnsbscribe = 2;

        if(docData) {
            const userName = docData.user.userName;
            const profilePic = docData.user.profilePic;
            const userId = docData.user.userId;
            const reporterId = docData.reporterId;
            const subReporterIds = docData.subReporterIds;

            const commentId = docData.id;
            const parentId = docData.parentId;  

            const postId = docData.postId;
            const postTitle = docData.postTitle;      
            const postType = docData.postType;
            const postImage = docData.postImage;

            const commentedTime = docData.createdTime;
            const directComment = docData.directComment;

            const userDocRef = admin.firestore().doc(`users_test/${userId}`);

            try {
                if(directComment) {
                    //Registration tokens are stored in users collection
                    const userInfoDoc = await userDocRef.get();
                    const userInfoData = userInfoDoc.data();

                    if(userInfoData)  {
                        const registrationToken = userInfoData.registrationToken;
                        const userTopics : string[] = userInfoData.topics;

                        if(userTopics && userTopics.length > maxTopicsCount) {
                            const unsubscribeTopics : string[] = userTopics.slice(0, numTopicsToUnsbscribe);
                            await unsubscribeTopicsFromUser(true, userDocRef, userInfoData, unsubscribeTopics);
                        }
                        
                        //Suscribe to topic with name postId if its a direct comment
                        if(registrationToken) await admin.messaging().subscribeToTopic(registrationToken, postId);
                        
                        //If topics list exist add newly created topic to it, else create topics list
                        let toicsCreateOrUpdatePromise;
                        if(userInfoData.topics) {
                            toicsCreateOrUpdatePromise = userDocRef.update({
                                topics: admin.firestore.FieldValue.arrayUnion(postId)
                            });
                        } else{
                            toicsCreateOrUpdatePromise = userDocRef.set({
                                topics : [postId]
                            }, {merge: true});
                        }
                       
                        const payload = {
                            "data":{
                                "postId" : `${postId}`,
                                "postTitle": `${postTitle}`,
                                "postType": `${postType}`,
                                "postImage": `${postImage}`,
        
                                "commentId": `${commentId}`, 
                                "isReply": `${false}`,
                                "time" : `${commentedTime.toMillis()}`,
        
                                "reporterId" : `${reporterId}`,
                                "subReporterIds" : `${subReporterIds}`,
                                "userId" : `${userId}`,
                                "userName": `${userName}`,
                                "profilePic": `${profilePic}`, 
                                "isCommentNotification" : "true"
                            }
                        }

                        const notificationPromise = admin.messaging().sendToTopic(postId, payload);
                        return Promise.all([toicsCreateOrUpdatePromise, notificationPromise]);

                    } else {
                        return null;
                    }

                } else {
                    //Send notification only to the original comment's user 
                    const parentComment = await admin.firestore().doc(`posts_test/${postId}/comments/${parentId}`).get();
                    const parentDocData = parentComment.data();

                    if(parentDocData) {
                        //Get registration token of commented user and parent comment user and subscribe them to
                        //topic with name parentCommentId
                        const parentCommentId = parentDocData.id;
                        const parentUserId = parentDocData.user.userId; 
                        const parentUserDocRef = admin.firestore().doc(`users_test/${parentUserId}`);
                
                        const parentUserInfoDoc = await parentUserDocRef.get();
                        const parentUserInfoData = parentUserInfoDoc.data();

                        const userInfoDoc = await userDocRef.get();
                        const userInfoData = userInfoDoc.data();

                        if(parentUserInfoData && userInfoData) {
                            const userRegToken = userInfoData.registrationToken;
                            const parentUserRegToken = parentUserInfoData.registrationToken;
                            const registrationTokens: string[] = [userRegToken, parentUserRegToken];

                            const userTopics : string[] = userInfoData.topics;
                            const parentUserTopics : string[] = parentUserInfoData.topics;

                            //Unsubscribe user from topics if user registerred to more than allowed topics limit
                            if(userTopics && userTopics.length > maxTopicsCount) {
                                const unsubscribeTopics : string[] = userTopics.slice(0, numTopicsToUnsbscribe);
                                await unsubscribeTopicsFromUser(true, userDocRef, userInfoData, unsubscribeTopics);
                            }

                            if(parentUserTopics && parentUserTopics.length > maxTopicsCount) {
                                const unsubscribeTopics : string[] = parentUserTopics.slice(0, numTopicsToUnsbscribe);
                                await unsubscribeTopicsFromUser(true, parentUserDocRef, parentUserInfoData, unsubscribeTopics);
                            }

                            await admin.messaging().subscribeToTopic(registrationTokens, parentCommentId);

                            let userTopicsCreateOrUpdatePromise;
                            let parentuserTopicsCreateOrUpdatePromise;

                            //Store the subscribed topic info in user documents
                            if(userInfoData.topics) {
                                userTopicsCreateOrUpdatePromise = userDocRef.update({
                                    topics: admin.firestore.FieldValue.arrayUnion(parentCommentId)
                                });
                            } else{
                                userTopicsCreateOrUpdatePromise = userDocRef.set({
                                    topics : [parentCommentId]
                                }, {merge: true});
                            }

                            if(parentUserInfoData.topics) {
                                parentuserTopicsCreateOrUpdatePromise = parentUserDocRef.update({
                                    topics: admin.firestore.FieldValue.arrayUnion(parentCommentId)
                                });
                            } else{
                                parentuserTopicsCreateOrUpdatePromise = parentUserDocRef.set({
                                    topics : [parentCommentId]
                                }, {merge: true});
                            }
                            
                            const replyPayload = {
                                "data":{
                                    "postId" : `${postId}`,
                                    "postTitle": `${postTitle}`,
                                    "postType": `${postType}`,
                                    "postImage": `${postImage}`,
            
                                    "commentId": `${commentId}`, 
                                    "isReply": `${true}`,
                                    "time" : `${commentedTime.toMillis()}`,
            
                                    "reporterId" : `${reporterId}`,
                                    "subReporterIds" : `${subReporterIds}`,
                                    "userId" : `${userId}`,
                                    "userName": `${userName}`,
                                    "profilePic": `${profilePic}`, 
                                    "isCommentNotification" : "true"
                                }
                            };

                            const notificationPromise = admin.messaging().sendToTopic(parentCommentId, replyPayload);
                            return Promise.all([userTopicsCreateOrUpdatePromise, parentuserTopicsCreateOrUpdatePromise, notificationPromise])

                        } else {
                            return null;
                        }

                    } else {
                        return null;
                    }
                }

            } catch(error) {

                console.log(error);
                return null;
            }
        } else {
            return null;
        }
       
    }); 


export const addCommentToPost = functions.firestore.document(`posts/{postId}/comments/{commentId}`)
    .onCreate(async (snapshot, context) => {
        const docData = snapshot.data();
        const maxTopicsCount = 1500;
        const numTopicsToUnsbscribe = 30;

        if(docData) {
            const userName = docData.user.userName;
            const profilePic = docData.user.profilePic;
            const userId = docData.user.userId;
            const reporterId = docData.reporterId;
            const subReporterIds = docData.subReporterIds;

            const commentId = docData.id;
            const parentId = docData.parentId;  

            const postId = docData.postId;
            const postTitle = docData.postTitle;      
            const postType = docData.postType;
            const postImage = docData.postImage;

            const commentedTime = docData.createdTime;
            const directComment = docData.directComment;
            
            const userDocRef = admin.firestore().doc(`users/${userId}`);

            try {
                if(directComment) {
                    //Registration tokens are stored in users collection
                    const userInfoDoc = await userDocRef.get();
                    const userInfoData = userInfoDoc.data();

                    if(userInfoData)  {
                        const registrationToken = userInfoData.registrationToken;
                        const userTopics : string[] = userInfoData.topics;

                        if(userTopics && userTopics.length > maxTopicsCount) {
                            const unsubscribeTopics : string[] = userTopics.slice(0, numTopicsToUnsbscribe);
                            await unsubscribeTopicsFromUser(false, userDocRef, userInfoData, unsubscribeTopics);
                        }

                        //Suscribe to topic with name postId if its a direct comment
                        if(registrationToken) await admin.messaging().subscribeToTopic(registrationToken, postId);
                       
                         //If topics list exist add newly created topic to it, else create topics list
                         let toicsCreateOrUpdatePromise;
                         if(userInfoData.topics) {
                             toicsCreateOrUpdatePromise = userDocRef.update({
                                 topics: admin.firestore.FieldValue.arrayUnion(postId)
                             });
                         } else{
                             toicsCreateOrUpdatePromise = userDocRef.set({
                                 topics : [postId]
                             }, {merge: true});
                         }
                       
                        const payload = {
                            "data":{
                                "postId" : `${postId}`,
                                "postTitle": `${postTitle}`,
                                "postType": `${postType}`,
                                "postImage": `${postImage}`,
        
                                "commentId": `${commentId}`, 
                                "isReply": `${false}`,
                                "time" : `${commentedTime.toMillis()}`,
        
                                "reporterId" : `${reporterId}`,
                                "subReporterIds" : `${subReporterIds}`,
                                "userId" : `${userId}`,
                                "userName": `${userName}`,
                                "profilePic": `${profilePic}`, 
                                "isCommentNotification" : "true"
                            }
                        }
                       
                        const notificationPromise = admin.messaging().sendToTopic(postId, payload);
                        return Promise.all([toicsCreateOrUpdatePromise, notificationPromise]);

                    } else {
                        return null;
                    }

                } else {
                    //Send notification only to the original comment's user 
                    const parentComment = await admin.firestore().doc(`posts/${postId}/comments/${parentId}`).get();
                    const parentDocData = parentComment.data();

                    if(parentDocData) {
                        //Get registration token of commented user and parent comment user and subscribe to them
                        //topic with name parentCommentId
                        const parentCommentId = parentDocData.id;
                        const parentUserId = parentDocData.user.userId; 
                        const parentUserDocRef = admin.firestore().doc(`users/${parentUserId}`);

                        const parentUserInfoDoc = await parentUserDocRef.get();
                        const parentUserInfoData = parentUserInfoDoc.data();

                        const userInfoDoc = await userDocRef.get();
                        const userInfoData = userInfoDoc.data();

                        if(parentUserInfoData && userInfoData) {
                            const userRegToken = userInfoData.registrationToken;
                            const parentUserRegToken = parentUserInfoData.registrationToken;
                            const registrationTokens: string[] = [userRegToken, parentUserRegToken];
                            
                            const userTopics : string[] = userInfoData.topics;
                            const parentUserTopics : string[] = parentUserInfoData.topics;

                            //Unsubscribe user from topics if user registerred to more than allowed topics limit
                            if(userTopics && userTopics.length > maxTopicsCount) {
                                const unsubscribeTopics : string[] = userTopics.slice(0, numTopicsToUnsbscribe);
                                await unsubscribeTopicsFromUser(false, userDocRef, userInfoData, unsubscribeTopics);
                            }

                            if(parentUserTopics && parentUserTopics.length > maxTopicsCount) {
                                const unsubscribeTopics : string[] = parentUserTopics.slice(0, numTopicsToUnsbscribe);
                                await unsubscribeTopicsFromUser(false, parentUserDocRef, parentUserInfoData, unsubscribeTopics);
                            }

                            await admin.messaging().subscribeToTopic(registrationTokens, parentCommentId);

                            let userTopicsCreateOrUpdatePromise;
                            let parentuserTopicsCreateOrUpdatePromise;

                            //Store the subscribed topic info in user documents
                            if(userInfoData.topics) {
                                userTopicsCreateOrUpdatePromise = userDocRef.update({
                                    topics: admin.firestore.FieldValue.arrayUnion(parentCommentId)
                                });
                            } else{
                                userTopicsCreateOrUpdatePromise = userDocRef.set({
                                    topics : [parentCommentId]
                                }, {merge: true});
                            }

                            if(parentUserInfoData.topics) {
                                parentuserTopicsCreateOrUpdatePromise = parentUserDocRef.update({
                                    topics: admin.firestore.FieldValue.arrayUnion(parentCommentId)
                                });
                            } else{
                                parentuserTopicsCreateOrUpdatePromise = parentUserDocRef.set({
                                    topics : [parentCommentId]
                                }, {merge: true});
                            }

                            const replyPayload = {
                                "data":{
                                    "postId" : `${postId}`,
                                    "postTitle": `${postTitle}`,
                                    "postType": `${postType}`,
                                    "postImage": `${postImage}`,
            
                                    "commentId": `${commentId}`, 
                                    "isReply": `${true}`,
                                    "time" : `${commentedTime.toMillis()}`,
            
                                    "reporterId" : `${reporterId}`,
                                    "subReporterIds" : `${subReporterIds}`,
                                    "userId" : `${userId}`,
                                    "userName": `${userName}`,
                                    "profilePic": `${profilePic}`, 
                                    "isCommentNotification" : "true"
                                }
                            };
                           
                            const notificationPromise = admin.messaging().sendToTopic(parentCommentId, replyPayload);
                            return Promise.all([userTopicsCreateOrUpdatePromise, parentuserTopicsCreateOrUpdatePromise, notificationPromise])
                        } else {
                            return null;
                        }

                    } else {
                        return null;
                    }
                }

            } catch(error) {
                console.log(error);
                return null;
            }
        } else {
            return null;
        }
       
    }); 

    async function unsubscribeTopicsFromUser(isTest: boolean, userDocRef:any, userInfoData:any, topicslist: string[]) {
        const respons : AxiosResponse =  await callLokalApiToUnsubscribe(true, userInfoData, topicslist);
        if(respons.status === 200)  {
            return userDocRef.update({
                topics: admin.firestore.FieldValue.arrayRemove(...topicslist)
            });
        } else{
              return null;
        }  
    }

    async function callLokalApiToUnsubscribe(isTest:boolean, userInfoData:any, topicslist: string[]) {
        const registrationToken = userInfoData.registrationToken;
        const authToken = "Token 1993c1513dacc28224ad9cb8d7e8bcbd89030b8f"
        const apiEndPoint:string = isTest ? 'http://testapi.getlokalapp.com/users/unsubscribe_topics/' : 'http://api.getlokalapp.com/users/unsubscribe_topics/';

        return axios({
                method: 'post',
                url: apiEndPoint,
                data: {
                    token : registrationToken,
                    topics: topicslist
                },
                headers: {
                    Authorization: authToken
                }
            })
    }
   
export const onReportCommentCreated = functions.firestore.document(`reported/{commentId}`)
    .onCreate(async (snapshot, context) => {
        return handleUserBlocking(snapshot.data())
    }); 

export const onReportCommentUpdated = functions.firestore.document(`reported/{commentId}`)
    .onUpdate(async (change, context) => {
        return handleUserBlocking(change.before.data())
    }); 

async function handleUserBlocking(dataSnapshot:any) {
    const maxAllowedreports = 10;

    if(dataSnapshot) {
        const userId : number = Number(dataSnapshot.user.userId);
        const profilePic = dataSnapshot.user.profilePic;
        const userName = dataSnapshot.user.userName;
        const numReports : number  = Number(dataSnapshot.numReports);
        //aditya - start - 1/06/2020
        const blockReasonId : number = Number(-1);
        const blockReason = "User has more than 10 reports";
        const defaultBlockReasonId : number = Number(0);
        const defaultBlockReason = "";
        //aditya - end

        //Check to see if the author of reported comment exists in 'users' collection
        const userInfoDoc = await admin.firestore().doc(`users/${userId}`).get();
        const userInfoData = userInfoDoc.data();

        if(userInfoDoc.exists && userInfoData) {
            const numOldReports : number = Number(userInfoData.numReports);
            const numNewReports : number = numOldReports + 1;

            if(numOldReports >= maxAllowedreports - 1) {
             //If numReports for a users reaches maximum value block that user, and add user document under blocked_users collection
                const promise1 = admin.firestore().doc(`users/${userId}`).set({
                    "numReports" : numNewReports,
                    "blocked" : true,
                    "blockedTime" : admin.firestore.FieldValue.serverTimestamp(),
                    //aditya - start - 1/06/2020
                    "blockReasonId" : blockReasonId,
                    "blockReason" : `${blockReason}`
                    //aditya - end
                }, {merge: true});

                const promise2 = admin.firestore().doc(`blocked_users/${userId}`).set({
                    "userId" : userId,
                    "profilePic" :  `${profilePic}`,
                    "userName" :  `${userName}`,
                    "numReports" : numNewReports,
                    "superUser" : false,
                    "blocked" : true,                    
                    "registrationToken" : "",
                    "blockedTime" : admin.firestore.FieldValue.serverTimestamp(),
                    //aditya - start - 1/06/2020
                    "blockReasonId" : blockReasonId,
                    "blockReason" : `${blockReason}`
                    //aditya - end
                });

                return Promise.all([promise1, promise2]);

            } else {
                return admin.firestore().doc(`users/${userId}`).update({"numReports": numNewReports});
            }

        } else{
            return admin.firestore().doc(`users/${userId}`).set( {
                "userId" : userId,
                "profilePic" :  `${profilePic}`,
                "userName" :  `${userName}`,
                "numReports" : numReports,
                "blocked" : false,
                "superUser" : false,
                "registrationToken" : "",
                //aditya - start - 1/06/2020
                "blockReasonId" : defaultBlockReasonId,
                "blockReason" : `${defaultBlockReason}`
                //aditya - end
            });
        }
        
    } else {
        return null;
    }
}

export const onReportCommentTestCreated = functions.firestore.document(`reported_test/{commentId}`)
    .onCreate(async (snapshot, context) => {
        return handleUserBlockingTest(snapshot.data())
    }); 

export const onReportCommentTestUpdated = functions.firestore.document(`reported_test/{commentId}`)
    .onUpdate(async (change, context) => {
        return handleUserBlockingTest(change.before.data())
    }); 

async function handleUserBlockingTest(dataSnapshot:any) {
    const maxAllowedreports = 10;

    if(dataSnapshot) {
        const userId : number = Number(dataSnapshot.user.userId);
        const profilePic = dataSnapshot.user.profilePic;
        const userName = dataSnapshot.user.userName;
        const numReports : number  = Number(dataSnapshot.numReports);
        //aditya - start - 1/06/2020
        const blockReasonId : number = Number(-1);
        const blockReason = "User has more than 10 reports";
        const defaultBlockReasonId : number = Number(0);
        const defaultBlockReason = "";
        //aditya - end

        //Check to see if the author of reported comment exists in 'users_test' collection
        const userInfoDoc = await admin.firestore().doc(`users_test/${userId}`).get();
        const userInfoData = userInfoDoc.data();

        if(userInfoDoc.exists && userInfoData) {
            const numOldReports : number = Number(userInfoData.numReports);
            const numNewReports : number = numOldReports + 1;

            if(numOldReports >= maxAllowedreports - 1) {
             //If numReports for a users reaches maximum value block that user, and add user document under blocked_users collection
                const promise1 = admin.firestore().doc(`users_test/${userId}`).set({
                    "numReports" : numNewReports,
                    "blocked" : true,
                    "blockedTime" : admin.firestore.FieldValue.serverTimestamp(),
                    //aditya - start - 1/06/2020
                    "blockReasonId" : blockReasonId,
                    "blockReason" : `${blockReason}`
                    //aditya - end
                }, {merge: true});

                const promise2 = admin.firestore().doc(`blocked_users_test/${userId}`).set({
                    "userId" : userId,
                    "profilePic" :  `${profilePic}`,
                    "userName" :  `${userName}`,
                    "numReports" : numNewReports,
                    "superUser" : false,
                    "blocked" : true,                    
                    "registrationToken" : "",
                    "blockedTime" : admin.firestore.FieldValue.serverTimestamp(),
                    //aditya - start - 1/06/2020
                    "blockReasonId" : blockReasonId,
                    "blockReason" : `${blockReason}`
                    //aditya - end
                });

                return Promise.all([promise1, promise2]);

            } else {
                return admin.firestore().doc(`users_test/${userId}`).update({"numReports": numNewReports});
            }

        } else{
            return admin.firestore().doc(`users_test/${userId}`).set( {
                "userId" : userId,
                "profilePic" :  `${profilePic}`,
                "userName" :  `${userName}`,
                "numReports" : numReports,
                "blocked" : false,
                "superUser" : false,
                "registrationToken" : "",
                //aditya - start - 1/06/2020
                "blockReasonId" : defaultBlockReasonId,
                "blockReason" : `${defaultBlockReason}`
                //aditya - end
            });
        }
        
    } else {
        return null;
    }
}

    // async function handleDirectCommentReport(afterSnapshot:any, beforeSnapshot:any) {
    //     const postId = beforeSnapshot.postId;
    //     // const parentId = beforeSnapshot.parentId;
    //     const commentId = beforeSnapshot.id;
    //     const reportsCount = afterSnapshot.numReports;

    //     try {
    //         await admin.firestore().doc(`posts_test/${postId}/comments/${commentId}`).update({numReports: reportsCount})
    //     } catch(error) {
    //         console.log(error);
    //     }
    // }

    // async function handleReplyReport(afterSnapshot:any, beforeSnapshot:any) {
    //     const db = admin.firestore();

    //     const postId = beforeSnapshot.postId;
    //     const parentId = beforeSnapshot.parentId;
    //     const commentId = beforeSnapshot.id;

    //     const previousReportCount = beforeSnapshot.numReports;
    //     const currentReportCount = afterSnapshot.numReports;

    //     const parentCommentRef = await admin.firestore().doc(`posts_test/${postId}/comments/${parentId}`);
    //     const commentRef = await admin.firestore().doc(`posts_test/${postId}/comments/${commentId}`);
    
    //     if(previousReportCount >= 3 && currentReportCount < 3 ) {
    //         //removed report on the comment
    //         db.runTransaction(t => {
    //             t.update(parentCommentRef,)
    //         });
    //         await admin.firestore().doc(`posts_test/${postId}/comments/${commentId}`).update({numReports: currentReportCount})
    //         await 
    //     }

        
    // }