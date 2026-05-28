require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    // 🛡️ 재원이 대리 출근 스케줄러 (매일 밤 9시 정각에 자동 출근 도장)
    cron.schedule('0 21 * * *', async () => {
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const today = kstDate.toISOString().split('T')[0];
        
        // 🎯 분석 완료된 재원이의 실제 디스코드 ID
        const JAEWON_ID = "1152202483666538516";
        const JAEWON_NAME = "smphur08";

        try {
            const { data: user, error: selectError } = await supabase
                .from('attendance')
                .select('*')
                .eq('user_id', JAEWON_ID)
                .maybeSingle();

            if (selectError) throw selectError;

            // 이미 오늘 출근했거나 대리 출근이 찍혔다면 중복 방지
            if (user && user.last_checkin === today) {
                console.log(`[재원봇] 재원이는 이미 오늘 출근 처리가 되어 있습니다.`);
                return;
            }

            // 연속 출근 일수(Streak) 보존 계산
            let newStreak = 1;
            if (user && user.last_checkin) {
                const yesterday = new Date(kstDate);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];

                if (user.last_checkin === yesterdayStr) {
                    newStreak = (user.streak || 0) + 1;
                }
            }

            // 상점 인플레이션 방지를 위해 대리 출근 시 토큰 추가 지급은 안 함 (기존 보유량 유지)
            const currentTokens = user ? (user.tokens ?? 200) : 200;
            const currentCards = user ? (user.protection_cards ?? 0) : 0;

            await supabase.from('attendance').upsert({
                user_id: JAEWON_ID,
                username: JAEWON_NAME,
                last_checkin: today,
                streak: newStreak,
                tokens: currentTokens,
                protection_cards: currentCards
            }, { onConflict: 'user_id' });

            console.log(`✨ [자동완료] 재원이 대리 출근 처리 성공! 현재 연속 ${newStreak}일째.`);

        } catch (err) {
            console.error("❌ 재원이 대리 출근 스케줄러 작동 실패:", err);
        }
    });

    // 정각 알림 스케줄러
    cron.schedule('0 * * * *', async () => {
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const today = kstDate.toISOString().split('T')[0];
        const currentHour = kstDate.getUTCHours();

        const messageText = getRemindMessage(currentHour);
        
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) { console.error(`${user.username} DM 전송 실패`); }
                    }
                }
            }
        }
    });

    // 매일 밤 23시 59분 자동 방어 및 리셋 스케줄러
    cron.schedule('59 23 * * *', async () => {
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const today = kstDate.toISOString().split('T')[0];

        const { data: allUsers } = await supabase.from('attendance').select('*');
        if (!allUsers) return;

        for (const user of allUsers) {
            if (user.last_checkin !== today && (user.streak || 0) > 0) {
                let cards = user.protection_cards || 0;
                
                if (cards > 0) {
                    cards -= 1;
                    await supabase
                        .from('attendance')
                        .update({ protection_cards: cards })
                        .eq('user_id', user.user_id);
                    
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`🛡️ 오늘 출근하지 않았지만, **출근 횟수 보호권**이 사용되어 연속 출근 기록이 유지되었습니다! (남은 보호권: ${cards}개)`);
                    } catch (e) {}
                } else {
                    await supabase
                        .from('attendance')
                        .update({ streak: 0 })
                        .eq('user_id', user.user_id);

                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`💀 보호권이 없어 오늘 자로 연속 출근 횟수가 초기화되었습니다. 내일부터 다시 힘내세요!`);
                    } catch (e) {}
                }
            }
        }
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const now = new Date();
    const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0];
    const currentHour = kstDate.getUTCHours();

    // 듀오링고 테스트 로직
    if (message.content === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다. (정기 알림 대기 중)`;

        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            return message.reply("성공! 개인 DM을 확인해보세요. 📩");
        } catch (err) {
            return message.reply("DM 전송에 실패했습니다. 설정을 확인해 보세요!");
        }
    }

    // 토큰 상점 로직 (!상점)
    if (message.content === "!상점") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const myTokens = user ? (user.tokens ?? 200) : 200;
            const myCards = user ? (user.protection_cards ?? 0) : 0;

            return message.reply(`🛒 **토큰 상점에 오신 것을 환영합니다!**\n\n` +
                                `👤 **내 정보**\n` +
                                `└ 보유 토큰: 💰 \`${myTokens} 토큰\`\n` +
                                `└ 보유 보호권: 🛡️ \`${myCards} 개\`\n\n` +
                                `📦 **판매 상품**\n` +
                                `└ 🛡️ **출근 횟수 보호권** | 가격: \`100 토큰\`\n` +
                                `   *하루 결근 시 자동으로 사용되어 연속 출근 기록을 지켜줍니다.*\n\n` +
                                `👉 **명령어 안내**\n` +
                                `└ 구매: \`!구매\`\n` +
                                `└ 환불: \`!환불\` (⚠️ 구매가 20% 수수료 **80 토큰** 환불)`);
        } catch (err) {
            return message.reply("상점을 불러오는 중 오류가 발생했습니다.");
        }
    }

    // 보호권 구매 로직 (!구매 보호권)
    if (message.content === "!구매") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentTokens < 100) {
                return message.reply(`❌ 토큰이 부족합니다! (현재 보유: 💰 \`${currentTokens} 토큰\`)`);
            }

            currentTokens -= 100;
            currentCards += 1;

            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: currentTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            return message.reply(`🛒 구매 완료! **출근 횟수 보호권** 1개를 획득했습니다. (잔여 토큰: 💰 \`${currentTokens}\` | 보유 보호권: 🛡️ \`${currentCards}개\`)`);
        } catch (err) {
            console.error(err);
            return message.reply("구매 처리 중 오류가 발생했습니다.");
        }
    }

    // 보호권 환불 로직 (!환불)
    if (message.content === "!환불") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;
            let currentStreak = user ? (user.streak ?? 0) : 0;
            let lastCheckin = user ? user.last_checkin : null;

            if (currentCards < 1) {
                return message.reply(`❌ 환불할 **출근 횟수 보호권**이 없습니다!`);
            }

            currentTokens += 80;
            currentCards -= 1;

            await supabase.from('attendance').upsert({
                user_id: userId,
                username: message.author.username,
                tokens: currentTokens,
                protection_cards: currentCards,
                streak: currentStreak,
                last_checkin: lastCheckin
            }, { onConflict: 'user_id' });

            return message.reply(`💸 환불 완료! 수수료 20%를 제외한 **80 토큰**이 반환되었습니다. (현재 보유: 💰 \`${currentTokens} 토큰\` | 보유 보호권: 🛡️ \`${currentCards}개\`)`);
        } catch (err) {
            console.error(err);
            return message.reply("환불 처리 중 오류가 발생했습니다.");
        }
    }

    // 출근 단어 예외 처리
    if (message.content !== "출근" && message.content !== "근출" && message.content !== "출" && message.content !== "근" && message.content !== "出勤" && message.content !== "ㅊㄱ" && message.content !== "출첵" && message.content !== "출석" && message.content !== "attend" && message.content !== "근." && message.content !== "출." && message.content !== "출 " && message.content !== "근 " && message.content !== "출군" && message.content !== "앙" && message.content !== "아잉" && message.content !== "웅" && message.content !== "출근해떠염"&& message.content !== "여자" && message.content !== "ㅊㅊ" && message.content !== "시기다른래퍼들의반대편을바라보던래퍼들의배포") return;

    if (currentHour >= 0 && currentHour < 4) {
        return message.reply("🚫 **지금은 출근 금지 시간입니다!**\n상쾌한 아침 공기를 마시며 다시 와주세요! 😴");
    }

    try {
        const { data: user, error: selectError } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (selectError) throw selectError;

        if (user && user.last_checkin === today) {
            return message.reply(`이미 오늘 출근하셨어요! ✨\n(오늘 날짜: ${today})`);
        }

        let earnedTokens = 10;
        if (currentHour < 14) {
            earnedTokens = 20;
        } else if (currentHour < 18) {
            earnedTokens = 15;
        }

        let newStreak = 1;
        if (user && user.last_checkin) {
            const yesterday = new Date(kstDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (user.last_checkin === yesterdayStr) {
                newStreak = (user.streak || 0) + 1;
            }
        }

        const totalTokens = (user ? (user.tokens ?? 200) : 200) + earnedTokens;
        const currentCards = user ? (user.protection_cards ?? 0) : 0;

        const { error: upsertError } = await supabase
            .from('attendance')
            .upsert({
                user_id: userId,
                username: message.author.username,
                last_checkin: today,
                streak: newStreak,
                tokens: totalTokens,
                protection_cards: currentCards
            }, { onConflict: 'user_id' });

        if (upsertError) throw upsertError;
        message.reply(`✅ **출근 완료!** 현재 **${newStreak}일** 연속 출근 중! 🔥\n💰 \`${earnedTokens} 토큰\` 획득! (총 보유: \`${totalTokens} 토큰\`)`);

    } catch (err) {
        console.error(err);
        message.reply("⚠️ DB 처리 오류 발생!");
    }
});

client.login(process.env.DISCORD_TOKEN);
